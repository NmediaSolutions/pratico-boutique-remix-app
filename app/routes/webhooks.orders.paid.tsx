import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

interface MagazineIssueNode {
  id: string;
  exportDate?: {
    value: string;
  };
  associatedProducts?: {
    references?: {
      edges: Array<{
        node?: {
          id: string;
        };
      }>;
    };
  };
}

interface ProductReference {
  node?: {
    id: string;
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== WEBHOOK CALLED ===");
  console.log("Request URL:", request.url);
  console.log("Request method:", request.method);

  let admin;
  let shop = "pratico-boutique-dev.myshopify.com";
  let payload;

  // Lire le body avant toute chose car il ne peut être lu qu'une seule fois
  const body = await request.text();
  payload = JSON.parse(body);
  console.log("Payload reçu pour commande:", payload.id);

  // Recréer un nouveau request avec le body pour l'authentification
  const clonedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: body,
  });

  try {
    const auth = await authenticate.webhook(clonedRequest);
    admin = auth.admin;
    shop = auth.shop;
    console.log(`Authenticated! ${auth.topic} webhook for ${shop}`);
  } catch (error) {
    console.error("Authentication error:", error);
    console.log("Webhook créé manuellement - traitement sans authentification");

    // Créer un admin client en utilisant unauthenticated.admin
    const { admin: unauthAdmin } = await unauthenticated.admin(shop);
    admin = unauthAdmin;

    console.log("Traitement avec client admin non-authentifié pour:", shop);
  }

  // Vérifier que admin est disponible
  if (!admin) {
    console.error("Admin API non disponible");
    return new Response("Admin API unavailable", { status: 503 });
  }

  try {
    const order = payload as {
      id: string;
      line_items: Array<{
        product_id: number;
        variant_id: number;
        quantity: number;
      }>;
      customer?: {
        id: number;
      };
    };

    // Vérifier qu'il y a un client
    if (!order.customer) {
      console.log("Commande sans client, skip");
      return new Response("OK - No customer", { status: 200 });
    }

    const customerId = `gid://shopify/Customer/${order.customer.id}`;
    const orderGid = `gid://shopify/Order/${order.id}`;

    console.log(`Traitement de la commande payée ${order.id}`);

    // Traiter chaque ligne de commande
    for (const lineItem of order.line_items) {
      try {
        // 1. Récupérer le produit avec ses tags
        const productResponse = await admin.graphql(
          `#graphql
            query getProduct($id: ID!) {
              product(id: $id) {
                id
                tags
              }
            }
          `,
          {
            variables: {
              id: `gid://shopify/Product/${lineItem.product_id}`,
            },
          },
        );

        const productData = await productResponse.json();
        const product = productData.data?.product;

        if (!product) {
          console.log(`Produit ${lineItem.product_id} non trouvé, skip`);
          continue;
        }

        // 2. Vérifier si le produit a le tag "magazine"
        const hasMagazineTag = product.tags.some(
          (tag: string) => tag.toLowerCase() === "magazine",
        );

        if (!hasMagazineTag) {
          console.log(
            `Produit ${lineItem.product_id} sans tag "magazine", skip`,
          );
          continue;
        }

        console.log(
          `Produit ${lineItem.product_id} est un abonnement magazine`,
        );

        // 3. Récupérer le variant avec son metafield issue_count
        const variantResponse = await admin.graphql(
          `#graphql
            query getVariant($id: ID!) {
              productVariant(id: $id) {
                id
                issueCount: metafield(namespace: "custom", key: "issue_count") {
                  value
                }
              }
            }
          `,
          {
            variables: {
              id: `gid://shopify/ProductVariant/${lineItem.variant_id}`,
            },
          },
        );

        const variantData = await variantResponse.json();
        const variant = variantData.data?.productVariant;

        if (!variant?.issueCount?.value) {
          console.error(
            `Variant ${lineItem.variant_id} sans metafield issue_count, skip`,
          );
          continue;
        }

        const issueCount = parseInt(variant.issueCount.value, 10);
        console.log(
          `Variant ${lineItem.variant_id} demande ${issueCount} numéros`,
        );

        // 4. Trouver les N prochains numéros de magazine associés à ce produit
        const magazineIssuesResponse = await admin.graphql(
          `#graphql
            query findMagazineIssues {
              metaobjects(
                type: "magazine_issue"
                first: 250
              ) {
                edges {
                  node {
                    id
                    exportDate: field(key: "export_date") {
                      value
                    }
                    associatedProducts: field(key: "associated_products") {
                      references(first: 10) {
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
        );

        const magazineIssuesData = await magazineIssuesResponse.json();
        const allIssues = magazineIssuesData.data?.metaobjects?.edges || [];

        // Filtrer les numéros qui correspondent à ce produit et dont la date est dans le futur
        const eligibleIssues = allIssues
          .map((edge: { node: MagazineIssueNode }) => edge.node)
          .filter((issue: MagazineIssueNode) => {
            // Vérifier si la date d'exportation est dans le futur
            const exportDate = issue.exportDate?.value;
            if (!exportDate || new Date(exportDate) <= new Date()) {
              return false;
            }

            // Vérifier si ce produit est dans associated_products
            const references =
              issue.associatedProducts?.references?.edges || [];
            return references.some(
              (ref: ProductReference) => ref.node?.id === product.id,
            );
          })
          .sort((a: MagazineIssueNode, b: MagazineIssueNode) => {
            // Trier par date d'exportation ascendante
            const dateA = new Date(a.exportDate?.value || 0).getTime();
            const dateB = new Date(b.exportDate?.value || 0).getTime();
            return dateA - dateB;
          })
          .slice(0, issueCount); // Prendre seulement les N premiers

        console.log(
          `Trouvé ${eligibleIssues.length} numéros éligibles (demandé: ${issueCount})`,
        );

        if (eligibleIssues.length === 0) {
          console.warn(
            `Aucun numéro de magazine disponible pour le produit ${lineItem.product_id}`,
          );
          continue;
        }

        if (eligibleIssues.length < issueCount) {
          console.warn(
            `Seulement ${eligibleIssues.length} numéros disponibles sur ${issueCount} demandés`,
          );
        }

        // 5. Créer les "Droit au numéro" pour chaque numéro trouvé
        for (const issue of eligibleIssues) {
          try {
            const createEntitlementResponse = await admin.graphql(
              `#graphql
                mutation createEntitlement($metaobject: MetaobjectCreateInput!) {
                  metaobjectCreate(metaobject: $metaobject) {
                    metaobject {
                      id
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
                  metaobject: {
                    type: "issue_entitlement",
                    fields: [
                      {
                        key: "customer",
                        value: customerId,
                      },
                      {
                        key: "magazine_issue",
                        value: issue.id,
                      },
                      {
                        key: "source_order",
                        value: orderGid,
                      },
                      {
                        key: "status",
                        value: "Actif",
                      },
                    ],
                  },
                },
              },
            );

            const createEntitlementData =
              await createEntitlementResponse.json();
            const errors =
              createEntitlementData.data?.metaobjectCreate?.userErrors;

            if (errors && errors.length > 0) {
              console.error(
                `Erreur création droit pour numéro ${issue.id}:`,
                errors,
              );
            } else {
              console.log(`Droit créé avec succès pour numéro ${issue.id}`);
            }
          } catch (error) {
            console.error(
              `Exception lors de la création du droit pour ${issue.id}:`,
              error,
            );
          }
        }

        console.log(
          `Traitement terminé pour ligne ${lineItem.variant_id}: ${eligibleIssues.length} droits créés`,
        );
      } catch (error) {
        console.error(
          `Erreur lors du traitement de la ligne ${lineItem.variant_id}:`,
          error,
        );
        // Continue avec les autres lignes même en cas d'erreur
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Erreur globale dans le webhook orders/paid:", error);
    return new Response("Error", { status: 500 });
  }
};
