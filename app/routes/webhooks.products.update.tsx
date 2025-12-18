import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  if (!admin) {
    throw new Response();
  }

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const productId = payload.admin_graphql_api_id || payload.id;

    if (!productId) {
      console.log("No product ID in payload");
      return new Response();
    }

    console.log(`Processing product: ${productId}`);

    // Récupérer les détails du produit avec le metafield magazine_issues
    const productQuery = await admin.graphql(
      `#graphql
        query GetProduct($id: ID!) {
          product(id: $id) {
            id
            title
            metafield(namespace: "custom", key: "magazine_issues") {
              id
              value
            }
          }
        }
      `,
      { variables: { id: productId } },
    );

    const productData = await productQuery.json();
    const product = productData.data?.product;

    if (!product) {
      console.log("Product not found");
      return new Response();
    }

    // Récupérer les IDs des magazines associés
    const magazineMetafield = product.metafield;
    let currentMagazineIds: string[] = [];

    if (magazineMetafield?.value) {
      try {
        const parsed = JSON.parse(magazineMetafield.value);
        currentMagazineIds = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.log("Error parsing magazine_issues metafield");
        return new Response();
      }
    }

    console.log(
      `Product ${product.title} is associated with ${currentMagazineIds.length} magazines`,
    );

    // D'abord, récupérer TOUS les magazines qui référencent ce produit
    // pour pouvoir nettoyer ceux qui ne sont plus dans la liste
    const allMagazinesQuery = await admin.graphql(
      `#graphql
        query SearchMetaobjects($query: String!) {
          metaobjects(type: "magazine_issue", first: 250, query: $query) {
            edges {
              node {
                id
                handle
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
          }
        }
      `,
      {
        variables: {
          query: `associated_products:${productId}`,
        },
      },
    );

    const allMagazinesData = await allMagazinesQuery.json();
    const allMagazines = allMagazinesData.data?.metaobjects?.edges || [];

    // Collecter les IDs de tous les magazines qui ont actuellement ce produit
    const magazinesWithProduct: string[] = [];
    for (const edge of allMagazines) {
      magazinesWithProduct.push(edge.node.id);
    }

    console.log(
      `Found ${magazinesWithProduct.length} magazines currently referencing this product`,
    );

    // Identifier les magazines à retirer (ceux qui avaient le produit mais ne sont plus dans currentMagazineIds)
    const magazinesToRemove = magazinesWithProduct.filter(
      (magId) => !currentMagazineIds.includes(magId),
    );

    // Retirer ce produit des magazines qui ne sont plus dans la liste
    for (const magazineId of magazinesToRemove) {
      try {
        console.log(
          `Removing product ${productId} from magazine ${magazineId}`,
        );

        // Trouver le magazine dans la liste
        const magazineEdge = allMagazines.find(
          (edge: { node: { id: string } }) => edge.node.id === magazineId,
        );
        if (!magazineEdge) continue;

        const magazine = magazineEdge.node;

        // Trouver le champ associated_products
        const associatedProductsField = magazine.fields.find(
          (field: { key: string }) => field.key === "associated_products",
        );

        if (!associatedProductsField) continue;

        // Extraire les IDs des produits actuellement associés
        const existingProductIds: string[] = [];
        if (associatedProductsField.references?.edges) {
          for (const edge of associatedProductsField.references.edges) {
            if (edge.node?.id && edge.node.id !== productId) {
              existingProductIds.push(edge.node.id);
            }
          }
        }

        // Mettre à jour le metaobject (sans ce produit)
        const updateMutation = await admin.graphql(
          `#graphql
            mutation UpdateMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]!) {
              metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
                metaobject {
                  id
                  handle
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
              id: magazineId,
              fields: [
                {
                  key: "associated_products",
                  value: JSON.stringify(existingProductIds),
                },
              ],
            },
          },
        );

        const updateResult = await updateMutation.json();
        const errors = updateResult.data?.metaobjectUpdate?.userErrors;

        if (errors && errors.length > 0) {
          console.error(
            `Error removing product from magazine ${magazineId}:`,
            JSON.stringify(errors),
          );
        } else {
          console.log(
            `Successfully removed product ${productId} from magazine ${magazineId}`,
          );
        }
      } catch (error) {
        console.error(
          `Error removing product from magazine ${magazineId}:`,
          error,
        );
      }
    }

    // Pour chaque magazine dans currentMagazineIds, s'assurer que le produit y est ajouté
    for (const magazineId of currentMagazineIds) {
      try {
        // Récupérer le metaobject magazine actuel
        const magazineQuery = await admin.graphql(
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
          { variables: { id: magazineId } },
        );

        const magazineData = await magazineQuery.json();
        const magazine = magazineData.data?.metaobject;

        if (!magazine || magazine.type !== "magazine_issue") {
          console.log(`Magazine ${magazineId} not found or wrong type`);
          continue;
        }

        // Trouver le champ associated_products
        const associatedProductsField = magazine.fields.find(
          (field: { key: string }) => field.key === "associated_products",
        );

        if (!associatedProductsField) {
          console.log(`No associated_products field in magazine ${magazineId}`);
          continue;
        }

        // Extraire les IDs des produits actuellement associés
        const existingProductIds: string[] = [];
        if (associatedProductsField.references?.edges) {
          for (const edge of associatedProductsField.references.edges) {
            if (edge.node?.id) {
              existingProductIds.push(edge.node.id);
            }
          }
        }

        // Vérifier si ce produit est déjà dans la liste
        if (existingProductIds.includes(productId)) {
          console.log(`Product ${productId} already in magazine ${magazineId}`);
          continue;
        }

        // Ajouter ce produit à la liste
        existingProductIds.push(productId);

        // Mettre à jour le metaobject
        const updateMutation = await admin.graphql(
          `#graphql
            mutation UpdateMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]!) {
              metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
                metaobject {
                  id
                  handle
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
              id: magazineId,
              fields: [
                {
                  key: "associated_products",
                  value: JSON.stringify(existingProductIds),
                },
              ],
            },
          },
        );

        const updateResult = await updateMutation.json();
        const errors = updateResult.data?.metaobjectUpdate?.userErrors;

        if (errors && errors.length > 0) {
          console.error(
            `Error updating magazine ${magazineId}:`,
            JSON.stringify(errors),
          );
        } else {
          console.log(
            `Successfully added product ${productId} to magazine ${magazineId}`,
          );
        }
      } catch (error) {
        console.error(`Error processing magazine ${magazineId}:`, error);
      }
    }

    return new Response();
  } catch (error) {
    console.error("Error processing product update webhook:", error);
    return new Response();
  }
};
