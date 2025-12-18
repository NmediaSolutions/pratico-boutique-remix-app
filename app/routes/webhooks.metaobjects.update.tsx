import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  if (!admin) {
    throw new Response();
  }

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log("Payload:", JSON.stringify(payload, null, 2));

  // Vérifier si c'est un metaobject de type "magazine_issue"
  if (payload.type !== "magazine_issue") {
    return new Response();
  }

  try {
    // Le payload contient déjà toutes les informations nécessaires
    const metaobjectId = payload.admin_graphql_api_id || payload.id;

    if (!metaobjectId) {
      console.log("No metaobject ID in payload");
      return new Response();
    }

    console.log(`Processing metaobject: ${metaobjectId}`);

    // Récupérer les détails complets du metaobject
    const metaobjectQuery = await admin.graphql(
      `#graphql
        query GetMetaobject($id: ID!) {
          metaobject(id: $id) {
            id
            handle
            type
            fields {
              key
              value
              references(first: 250) {
                edges {
                  node {
                    ... on Product {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { id: metaobjectId } },
    );

    const metaobjectData = await metaobjectQuery.json();
    const metaobject = metaobjectData.data?.metaobject;

    if (!metaobject) {
      console.log("Metaobject not found");
      return new Response();
    }

    // Trouver le champ associated_products
    const associatedProductsField = metaobject.fields.find(
      (field: { key: string }) => field.key === "associated_products",
    );

    if (!associatedProductsField) {
      console.log("No associated_products field found");
      return new Response();
    }

    // Extraire les IDs des produits associés
    const productIds: string[] = [];
    if (associatedProductsField.references?.edges) {
      for (const edge of associatedProductsField.references.edges) {
        if (edge.node?.id) {
          productIds.push(edge.node.id);
        }
      }
    }

    console.log(
      `Magazine ${metaobject.handle} has ${productIds.length} associated products`,
    );

    // Pour chaque produit, mettre à jour son metafield custom.magazine_issues
    for (const productId of productIds) {
      try {
        // D'abord, récupérer les numéros de magazine actuels du produit
        const productMetafieldQuery = await admin.graphql(
          `#graphql
            query GetProductMetafield($id: ID!) {
              product(id: $id) {
                id
                metafield(namespace: "custom", key: "magazine_issues") {
                  id
                  value
                }
              }
            }
          `,
          { variables: { id: productId } },
        );

        const productData = await productMetafieldQuery.json();
        const currentMetafield = productData.data?.product?.metafield;

        // Parser les IDs existants
        let existingMagazineIds: string[] = [];
        if (currentMetafield?.value) {
          try {
            const parsed = JSON.parse(currentMetafield.value);
            existingMagazineIds = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            console.log("Error parsing existing metafield value");
          }
        }

        // Ajouter ce magazine s'il n'est pas déjà présent
        if (!existingMagazineIds.includes(metaobjectId)) {
          existingMagazineIds.push(metaobjectId);

          // Mettre à jour le metafield
          const updateMutation = await admin.graphql(
            `#graphql
              mutation UpdateProductMetafield($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  metafields {
                    id
                    namespace
                    key
                    value
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }
            `,
            {
              variables: {
                metafields: [
                  {
                    ownerId: productId,
                    namespace: "custom",
                    key: "magazine_issues",
                    type: "list.metaobject_reference",
                    value: JSON.stringify(existingMagazineIds),
                  },
                ],
              },
            },
          );

          const updateResult = await updateMutation.json();
          const errors = updateResult.data?.metafieldsSet?.userErrors;

          if (errors && errors.length > 0) {
            console.error(
              `Error updating product ${productId}:`,
              JSON.stringify(errors),
            );
          } else {
            console.log(
              `Successfully added magazine ${metaobjectId} to product ${productId}`,
            );
          }
        } else {
          console.log(
            `Magazine ${metaobjectId} already associated with product ${productId}`,
          );
        }
      } catch (error) {
        console.error(`Error processing product ${productId}:`, error);
      }
    }

    // Nettoyer les produits qui ne sont plus associés
    // Trouver tous les produits qui ont ce magazine dans leur metafield
    const searchQuery = await admin.graphql(
      `#graphql
        query SearchProducts($query: String!) {
          products(first: 250, query: $query) {
            edges {
              node {
                id
                title
                metafield(namespace: "custom", key: "magazine_issues") {
                  id
                  value
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: `metafields.custom.magazine_issues:${metaobjectId}`,
        },
      },
    );

    const searchData = await searchQuery.json();
    const productsWithMagazine = searchData.data?.products?.edges || [];

    // Pour chaque produit qui a ce magazine, vérifier s'il est toujours dans la liste
    for (const edge of productsWithMagazine) {
      const product = edge.node;
      if (!productIds.includes(product.id)) {
        // Ce produit avait le magazine mais n'est plus dans associated_products
        // Retirer le magazine du metafield du produit
        try {
          const metafieldValue = product.metafield?.value;
          if (metafieldValue) {
            let magazineIds: string[] = [];
            try {
              const parsed = JSON.parse(metafieldValue);
              magazineIds = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
              console.log(`Error parsing metafield for product ${product.id}`);
              continue;
            }

            // Retirer ce magazine de la liste
            const filteredMagazineIds = magazineIds.filter(
              (id) => id !== metaobjectId,
            );

            if (filteredMagazineIds.length !== magazineIds.length) {
              // Mettre à jour le metafield
              const updateMutation = await admin.graphql(
                `#graphql
                  mutation UpdateProductMetafield($metafields: [MetafieldsSetInput!]!) {
                    metafieldsSet(metafields: $metafields) {
                      metafields {
                        id
                        namespace
                        key
                        value
                      }
                      userErrors {
                        field
                        message
                      }
                    }
                  }
                `,
                {
                  variables: {
                    metafields: [
                      {
                        ownerId: product.id,
                        namespace: "custom",
                        key: "magazine_issues",
                        type: "list.metaobject_reference",
                        value: JSON.stringify(filteredMagazineIds),
                      },
                    ],
                  },
                },
              );

              const updateResult = await updateMutation.json();
              const errors = updateResult.data?.metafieldsSet?.userErrors;

              if (errors && errors.length > 0) {
                console.error(
                  `Error removing magazine from product ${product.id}:`,
                  JSON.stringify(errors),
                );
              } else {
                console.log(
                  `Successfully removed magazine ${metaobjectId} from product ${product.id}`,
                );
              }
            }
          }
        } catch (error) {
          console.error(`Error cleaning up product ${product.id}:`, error);
        }
      }
    }

    return new Response();
  } catch (error) {
    console.error("Error processing metaobject update webhook:", error);
    return new Response();
  }
};
