import type { ActionFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";

interface MagazineIssueNode {
  id: string;
  status?: {
    value: string;
  };
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

interface AdminGraphQL {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

// Helper function to create an alert metaobject
async function createMagazineIssueAlert(
  admin: AdminGraphQL,
  alertData: {
    orderGid: string;
    customerId: string;
    productId: string;
    subscriptionId?: string;
    requiredIssues: number;
    availableIssues: number;
    alertType: "no_issues" | "insufficient_issues";
    orderType: "new_order" | "renewal";
  },
) {
  try {
    const fields: Array<{ key: string; value: string }> = [
      {
        key: "alert_type",
        value: alertData.alertType,
      },
      {
        key: "order_type",
        value: alertData.orderType,
      },
      {
        key: "order",
        value: alertData.orderGid,
      },
      {
        key: "customer",
        value: alertData.customerId,
      },
      {
        key: "product",
        value: alertData.productId,
      },
      {
        key: "required_issues",
        value: alertData.requiredIssues.toString(),
      },
      {
        key: "available_issues",
        value: alertData.availableIssues.toString(),
      },
      {
        key: "alert_date",
        value: new Date().toISOString(),
      },
      {
        key: "status",
        value: "unresolved",
      },
    ];

    // Add subscription field if provided
    if (alertData.subscriptionId) {
      fields.push({
        key: "subscription",
        value: alertData.subscriptionId,
      });
    }

    const alertResponse = await admin.graphql(
      `#graphql
        mutation createAlert($metaobject: MetaobjectCreateInput!) {
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
            type: "magazine_issue_alert",
            fields: fields,
          },
        },
      },
    );

    const alertResult = await alertResponse.json();
    const errors = alertResult.data?.metaobjectCreate?.userErrors;

    if (errors && errors.length > 0) {
      console.error("Error creating magazine issue alert:", errors);
      return null;
    }

    const alertId = alertResult.data?.metaobjectCreate?.metaobject?.id;
    console.log(
      `🚨 Magazine issue alert created: ${alertId} - ${alertData.alertType} (${alertData.orderType})`,
    );
    return alertId;
  } catch (error) {
    console.error("Exception creating magazine issue alert:", error);
    return null;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("=== WEBHOOK CALLED ===");
  console.log("Request URL:", request.url);
  console.log("Request method:", request.method);

  let admin;
  let shop = "pratico-boutique-dev.myshopify.com";

  // Lire le body avant toute chose car il ne peut être lu qu'une seule fois
  const body = await request.text();
  const payload = JSON.parse(body);
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

    // Check if order already has subscriptions (renewal order from draft order)
    const checkOrderSubscriptionsResponse = await admin.graphql(
      `#graphql
        query getOrderSubscriptions($id: ID!) {
          order(id: $id) {
            id
            note
            subscriptions: metafield(namespace: "custom", key: "subscriptions") {
              value
            }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  key
                  value
                  namespace
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: orderGid,
        },
      },
    );

    const orderSubscriptionsData = await checkOrderSubscriptionsResponse.json();

    // Debug logging
    console.log(
      "Order data from GraphQL:",
      JSON.stringify(orderSubscriptionsData.data?.order, null, 2),
    );
    console.log("Order note:", orderSubscriptionsData.data?.order?.note);
    console.log(
      "All custom metafields:",
      orderSubscriptionsData.data?.order?.metafields?.edges,
    );

    const existingSubscriptions =
      orderSubscriptionsData.data?.order?.subscriptions?.value;

    if (existingSubscriptions) {
      console.log(
        `Commande ${order.id} est un renouvellement avec abonnements existants:`,
        existingSubscriptions,
      );

      // Parse the subscription IDs
      const subscriptionIds = JSON.parse(existingSubscriptions);
      console.log(
        `${subscriptionIds.length} abonnement(s) à mettre à jour pour ce renouvellement`,
      );

      // Update each subscription with the new order and increment renewals
      for (const subscriptionId of subscriptionIds) {
        try {
          // First, get the current subscription data including product and existing entitlements
          const getSubscriptionResponse = await admin.graphql(
            `#graphql
              query getSubscription($id: ID!) {
                metaobject(id: $id) {
                  id
                  renewalsAmount: field(key: "renewals_amount") {
                    value
                  }
                  orders: field(key: "orders") {
                    value
                  }
                  product: field(key: "products") {
                    reference {
                      ... on Product {
                        id
                      }
                    }
                  }
                  issueEntitlements: field(key: "issue_entitlements") {
                    references(first: 250) {
                      edges {
                        node {
                          ... on Metaobject {
                            id
                            magazineIssue: field(key: "magazine_issue") {
                              reference {
                                ... on Metaobject {
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
              }
            `,
            {
              variables: {
                id: subscriptionId,
              },
            },
          );

          const subscriptionData = await getSubscriptionResponse.json();
          const subscription = subscriptionData.data?.metaobject;

          if (!subscription) {
            console.error(`Abonnement ${subscriptionId} non trouvé`);
            continue;
          }

          const currentRenewals = parseInt(
            subscription.renewalsAmount?.value || "0",
            10,
          );
          const newRenewalsCount = currentRenewals + 1;

          const productId = subscription.product?.reference?.id;
          if (!productId) {
            console.error(`Abonnement ${subscriptionId} sans produit associé`);
            continue;
          }

          console.log(
            `Traitement renouvellement pour abonnement ${subscriptionId}, produit ${productId}`,
          );

          // Get existing magazine issues to avoid duplicates
          const existingMagazineIssueIds = new Set(
            subscription.issueEntitlements?.references?.edges
              ?.map(
                (edge: {
                  node: {
                    magazineIssue?: { reference?: { id: string } };
                  };
                }) => edge.node?.magazineIssue?.reference?.id,
              )
              .filter(Boolean) || [],
          );

          console.log(
            `Abonnement a déjà ${existingMagazineIssueIds.size} numéro(s) de magazine`,
          );

          // Get the line item for this product to determine how many issues to add
          const lineItem = order.line_items.find(
            (item) => `gid://shopify/Product/${item.product_id}` === productId,
          );

          if (!lineItem) {
            console.error(
              `Aucune ligne de commande trouvée pour le produit ${productId}`,
            );
            continue;
          }

          // Get issue count from variant
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
          const issueCount = parseInt(
            variantData.data?.productVariant?.issueCount?.value || "0",
            10,
          );

          if (issueCount === 0) {
            console.error(
              `Variant ${lineItem.variant_id} sans issue_count valide`,
            );
            continue;
          }

          console.log(
            `Le variant demande ${issueCount} nouveaux numéros pour le renouvellement`,
          );

          // Get all magazine issues for this product
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
                      status: field(key: "status") {
                        value
                      }
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

          // Filter for future issues not already in subscription
          const eligibleNewIssues = allIssues
            .map((edge: { node: MagazineIssueNode }) => edge.node)
            .filter((issue: MagazineIssueNode) => {
              // Skip if already in subscription
              if (existingMagazineIssueIds.has(issue.id)) {
                return false;
              }

              // Check if status is "Envoyé" (skip if true)
              const status = issue.status?.value;
              if (status === "Envoyé") {
                return false;
              }

              // Check if date is in the future
              const exportDate = issue.exportDate?.value;
              if (!exportDate || new Date(exportDate) <= new Date()) {
                return false;
              }

              // Check if this product is associated
              const references =
                issue.associatedProducts?.references?.edges || [];
              return references.some(
                (ref: ProductReference) => ref.node?.id === productId,
              );
            })
            .sort((a: MagazineIssueNode, b: MagazineIssueNode) => {
              const dateA = new Date(a.exportDate?.value || 0).getTime();
              const dateB = new Date(b.exportDate?.value || 0).getTime();
              return dateA - dateB;
            })
            .slice(0, issueCount);

          console.log(
            `Trouvé ${eligibleNewIssues.length} nouveaux numéros éligibles (demandé: ${issueCount})`,
          );

          if (eligibleNewIssues.length === 0) {
            console.warn(
              `Aucun nouveau numéro disponible pour l'abonnement ${subscriptionId}`,
            );

            // Create alert for no issues available
            await createMagazineIssueAlert(admin, {
              orderGid,
              customerId,
              productId,
              subscriptionId,
              requiredIssues: issueCount,
              availableIssues: 0,
              alertType: "no_issues",
              orderType: "renewal",
            });

            continue;
          }

          if (eligibleNewIssues.length < issueCount) {
            console.warn(
              `Seulement ${eligibleNewIssues.length} numéros disponibles sur ${issueCount} demandés`,
            );

            // Create alert for insufficient issues
            await createMagazineIssueAlert(admin, {
              orderGid,
              customerId,
              productId,
              subscriptionId,
              requiredIssues: issueCount,
              availableIssues: eligibleNewIssues.length,
              alertType: "insufficient_issues",
              orderType: "renewal",
            });
          }

          // Create new entitlements for the new issues
          const newEntitlementIds: string[] = [];

          for (const issue of eligibleNewIssues) {
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
                        {
                          key: "subscription",
                          value: subscriptionId,
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
                const entitlementId =
                  createEntitlementData.data?.metaobjectCreate?.metaobject?.id;
                if (entitlementId) {
                  newEntitlementIds.push(entitlementId);
                  console.log(
                    `Nouveau droit créé pour numéro ${issue.id}: ${entitlementId}`,
                  );
                }
              }
            } catch (error) {
              console.error(
                `Exception lors de la création du droit pour ${issue.id}:`,
                error,
              );
            }
          }

          // Get current entitlement IDs and add new ones
          let allEntitlementIds = [];
          try {
            const currentEntitlementIds =
              subscription.issueEntitlements?.references?.edges?.map(
                (edge: { node: { id: string } }) => edge.node.id,
              ) || [];
            allEntitlementIds = [
              ...currentEntitlementIds,
              ...newEntitlementIds,
            ];
          } catch (e) {
            console.error("Erreur parsing entitlements:", e);
            allEntitlementIds = newEntitlementIds;
          }

          // Parse existing orders list
          let ordersList = [];
          try {
            ordersList = subscription.orders?.value
              ? JSON.parse(subscription.orders.value)
              : [];
          } catch (e) {
            console.error("Erreur parsing orders list:", e);
            ordersList = [];
          }

          // Add current order to the list if not already present
          if (!ordersList.includes(orderGid)) {
            ordersList.push(orderGid);
          }

          console.log(
            `Mise à jour de l'abonnement ${subscriptionId}: renouvellement ${newRenewalsCount}, ${ordersList.length} commande(s), ${allEntitlementIds.length} droits totaux`,
          );

          // Update the subscription
          const updateSubscriptionResponse = await admin.graphql(
            `#graphql
              mutation updateSubscription($id: ID!, $metaobject: MetaobjectUpdateInput!) {
                metaobjectUpdate(id: $id, metaobject: $metaobject) {
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
                id: subscriptionId,
                metaobject: {
                  fields: [
                    {
                      key: "order",
                      value: orderGid,
                    },
                    {
                      key: "orders",
                      value: JSON.stringify(ordersList),
                    },
                    {
                      key: "renewals_amount",
                      value: newRenewalsCount.toString(),
                    },
                    {
                      key: "issue_entitlements",
                      value: JSON.stringify(allEntitlementIds),
                    },
                  ],
                },
              },
            },
          );

          const updateData = await updateSubscriptionResponse.json();
          const updateErrors = updateData.data?.metaobjectUpdate?.userErrors;

          if (updateErrors && updateErrors.length > 0) {
            console.error(
              `Erreur mise à jour abonnement ${subscriptionId}:`,
              updateErrors,
            );
          } else {
            console.log(
              `Abonnement ${subscriptionId} mis à jour avec succès: ${newEntitlementIds.length} nouveaux droits ajoutés (renouvellement ${newRenewalsCount})`,
            );
          }
        } catch (error) {
          console.error(
            `Exception lors de la mise à jour de l'abonnement ${subscriptionId}:`,
            error,
          );
        }
      }

      console.log(
        `Traitement du renouvellement terminé pour la commande ${order.id}`,
      );
      return new Response("OK - Renewal processed", { status: 200 });
    }

    console.log(
      `Commande ${order.id} est une nouvelle commande - création des abonnements`,
    );

    // Array to collect all subscription IDs for the entire order
    const allSubscriptionIds: string[] = [];

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
                    status: field(key: "status") {
                      value
                    }
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
            // Check if status is "Envoyé" (skip if true)
            const status = issue.status?.value;
            if (status === "Envoyé") {
              return false;
            }

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

          // Create alert for no issues available
          await createMagazineIssueAlert(admin, {
            orderGid,
            customerId,
            productId: product.id,
            requiredIssues: issueCount,
            availableIssues: 0,
            alertType: "no_issues",
            orderType: "new_order",
          });

          continue;
        }

        if (eligibleIssues.length < issueCount) {
          console.warn(
            `Seulement ${eligibleIssues.length} numéros disponibles sur ${issueCount} demandés`,
          );

          // Create alert for insufficient issues
          await createMagazineIssueAlert(admin, {
            orderGid,
            customerId,
            productId: product.id,
            requiredIssues: issueCount,
            availableIssues: eligibleIssues.length,
            alertType: "insufficient_issues",
            orderType: "new_order",
          });
        }

        // 5. Créer les "Droit au numéro" pour chaque numéro trouvé
        const createdEntitlementIds: string[] = [];

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
              const entitlementId =
                createEntitlementData.data?.metaobjectCreate?.metaobject?.id;
              if (entitlementId) {
                createdEntitlementIds.push(entitlementId);
                console.log(
                  `Droit créé avec succès pour numéro ${issue.id}: ${entitlementId}`,
                );
              }
            }
          } catch (error) {
            console.error(
              `Exception lors de la création du droit pour ${issue.id}:`,
              error,
            );
          }
        }

        // 6. Créer l'abonnement pour ce produit
        if (createdEntitlementIds.length > 0) {
          try {
            // Générer un ID unique pour l'abonnement
            const subscriptionId = `SUB-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;

            // Date de début de l'abonnement (aujourd'hui)
            const subscriptionStartDate = new Date()
              .toISOString()
              .split("T")[0]; // Format YYYY-MM-DD

            console.log(
              `Création de l'abonnement ${subscriptionId} pour le produit ${product.id}`,
            );

            const createSubscriptionResponse = await admin.graphql(
              `#graphql
                mutation createSubscription($metaobject: MetaobjectCreateInput!) {
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
                    type: "subscription",
                    fields: [
                      {
                        key: "subscription_id",
                        value: subscriptionId,
                      },
                      {
                        key: "subscription_status",
                        value: "Abonné",
                      },
                      {
                        key: "products",
                        value: product.id,
                      },
                      {
                        key: "order",
                        value: orderGid,
                      },
                      {
                        key: "renewals_amount",
                        value: "0",
                      },
                      {
                        key: "subscription_start_date",
                        value: subscriptionStartDate,
                      },
                      {
                        key: "issue_entitlements",
                        value: JSON.stringify(createdEntitlementIds),
                      },
                    ],
                  },
                },
              },
            );

            const createSubscriptionData =
              await createSubscriptionResponse.json();
            const subscriptionErrors =
              createSubscriptionData.data?.metaobjectCreate?.userErrors;

            if (subscriptionErrors && subscriptionErrors.length > 0) {
              console.error(
                `Erreur création abonnement ${subscriptionId}:`,
                subscriptionErrors,
              );
            } else {
              const subscriptionGid =
                createSubscriptionData.data?.metaobjectCreate?.metaobject?.id;
              console.log(`Abonnement créé avec succès: ${subscriptionGid}`);

              // Add to order's subscription list
              if (subscriptionGid) {
                allSubscriptionIds.push(subscriptionGid);
              }

              // 7. Mettre à jour chaque entitlement pour lier l'abonnement
              for (const entitlementId of createdEntitlementIds) {
                try {
                  const updateEntitlementResponse = await admin.graphql(
                    `#graphql
                      mutation updateEntitlement($id: ID!, $metaobject: MetaobjectUpdateInput!) {
                        metaobjectUpdate(id: $id, metaobject: $metaobject) {
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
                        id: entitlementId,
                        metaobject: {
                          fields: [
                            {
                              key: "subscription",
                              value: subscriptionGid,
                            },
                          ],
                        },
                      },
                    },
                  );

                  const updateEntitlementData =
                    await updateEntitlementResponse.json();
                  const updateErrors =
                    updateEntitlementData.data?.metaobjectUpdate?.userErrors;

                  if (updateErrors && updateErrors.length > 0) {
                    console.error(
                      `Erreur mise à jour entitlement ${entitlementId} avec abonnement:`,
                      updateErrors,
                    );
                  } else {
                    console.log(
                      `Entitlement ${entitlementId} lié à l'abonnement ${subscriptionGid}`,
                    );
                  }
                } catch (error) {
                  console.error(
                    `Exception lors de la mise à jour de l'entitlement ${entitlementId}:`,
                    error,
                  );
                }
              }
            }
          } catch (error) {
            console.error(
              `Exception lors de la création de l'abonnement pour le produit ${product.id}:`,
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

    // 8. Mettre à jour le metafield custom.subscriptions de la commande
    if (allSubscriptionIds.length > 0) {
      try {
        console.log(
          `Mise à jour du metafield subscriptions de la commande avec ${allSubscriptionIds.length} abonnement(s)`,
        );

        const updateOrderResponse = await admin.graphql(
          `#graphql
            mutation updateOrderMetafield($input: OrderInput!) {
              orderUpdate(input: $input) {
                order {
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
              input: {
                id: orderGid,
                metafields: [
                  {
                    namespace: "custom",
                    key: "subscriptions",
                    type: "list.metaobject_reference",
                    value: JSON.stringify(allSubscriptionIds),
                  },
                ],
              },
            },
          },
        );

        const updateOrderData = await updateOrderResponse.json();
        const orderErrors = updateOrderData.data?.orderUpdate?.userErrors;

        if (orderErrors && orderErrors.length > 0) {
          console.error(
            "Erreur mise à jour metafield subscriptions de la commande:",
            orderErrors,
          );
        } else {
          console.log(
            `Metafield custom.subscriptions de la commande mis à jour avec succès`,
          );
        }
      } catch (error) {
        console.error(
          "Exception lors de la mise à jour du metafield de la commande:",
          error,
        );
      }
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Erreur globale dans le webhook orders/paid:", error);
    return new Response("Error", { status: 500 });
  }
};
