import { useState, useCallback, useEffect } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useSubmit,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";

interface Subscription {
  id: string;
  subscriptionId: string;
  status: string;
  product: {
    id: string;
    title: string;
  };
  customer: {
    id: string;
    displayName: string;
    email: string;
  };
  renewalsCount: number;
}

interface ProductVariant {
  id: string;
  title: string;
  price: string;
  issueCount: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Get all active subscriptions
  const subscriptionsResponse = await admin.graphql(
    `#graphql
      query getSubscriptions {
        metaobjects(type: "subscription", first: 250) {
          edges {
            node {
              id
              subscriptionId: field(key: "subscription_id") {
                value
              }
              status: field(key: "subscription_status") {
                value
              }
              product: field(key: "products") {
                reference {
                  ... on Product {
                    id
                    title
                  }
                }
              }
              renewalsAmount: field(key: "renewals_amount") {
                value
              }
              issueEntitlements: field(key: "issue_entitlements") {
                references(first: 1) {
                  edges {
                    node {
                      ... on Metaobject {
                        customer: field(key: "customer") {
                          reference {
                            ... on Customer {
                              id
                              displayName
                              email
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
        }
      }
    `,
  );

  const subscriptionsData = await subscriptionsResponse.json();
  const subscriptions: Subscription[] = [];

  for (const edge of subscriptionsData.data?.metaobjects?.edges || []) {
    const node = edge.node;
    const status = node.status?.value || "";

    if (status === "Abonné") {
      // Get customer from first entitlement
      const customerRef =
        node.issueEntitlements?.references?.edges?.[0]?.node?.customer
          ?.reference;

      if (customerRef && node.product?.reference) {
        subscriptions.push({
          id: node.id,
          subscriptionId: node.subscriptionId?.value || "",
          status: status,
          product: {
            id: node.product.reference.id,
            title: node.product.reference.title,
          },
          customer: {
            id: customerRef.id,
            displayName: customerRef.displayName,
            email: customerRef.email || "",
          },
          renewalsCount: parseInt(node.renewalsAmount?.value || "0", 10),
        });
      }
    }
  }

  return {
    subscriptions: subscriptions.sort((a, b) =>
      a.subscriptionId.localeCompare(b.subscriptionId),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const subscriptionId = formData.get("subscriptionId") as string;
  const variantId = formData.get("variantId") as string;

  if (!subscriptionId || !variantId) {
    return {
      success: false,
      error: "Abonnement et variant requis",
    };
  }

  try {
    // Get subscription details
    const subscriptionResponse = await admin.graphql(
      `#graphql
        query getSubscription($id: ID!) {
          metaobject(id: $id) {
            id
            product: field(key: "products") {
              reference {
                ... on Product {
                  id
                }
              }
            }
            issueEntitlements: field(key: "issue_entitlements") {
              references(first: 1) {
                edges {
                  node {
                    ... on Metaobject {
                      customer: field(key: "customer") {
                        reference {
                          ... on Customer {
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

    const subscriptionData = await subscriptionResponse.json();
    const subscription = subscriptionData.data?.metaobject;

    if (!subscription) {
      return {
        success: false,
        error: "Abonnement non trouvé",
      };
    }

    const customerId =
      subscription.issueEntitlements?.references?.edges?.[0]?.node?.customer
        ?.reference?.id;
    const productId = subscription.product?.reference?.id;

    if (!customerId || !productId) {
      return {
        success: false,
        error: "Client ou produit manquant dans l'abonnement",
      };
    }

    // Get variant details
    const variantResponse = await admin.graphql(
      `#graphql
        query getVariant($id: ID!) {
          productVariant(id: $id) {
            id
            price
            product {
              id
            }
          }
        }
      `,
      {
        variables: {
          id: variantId,
        },
      },
    );

    const variantData = await variantResponse.json();
    const variant = variantData.data?.productVariant;

    if (!variant || variant.product.id !== productId) {
      return {
        success: false,
        error:
          "Variant invalide ou ne correspond pas au produit de l'abonnement",
      };
    }

    // Create the draft order (without metafields - they will be added to the ORDER after completion)
    const createOrderResponse = await admin.graphql(
      `#graphql
        mutation draftOrderCreate($input: DraftOrderInput!) {
          draftOrderCreate(input: $input) {
            draftOrder {
              id
              order {
                id
                name
              }
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
            customerId: customerId,
            lineItems: [
              {
                variantId: variantId,
                quantity: 1,
              },
            ],
          },
        },
      },
    );

    const createOrderData = await createOrderResponse.json();
    const errors = createOrderData.data?.draftOrderCreate?.userErrors;

    if (errors && errors.length > 0) {
      return {
        success: false,
        error: errors.map((e: { message: string }) => e.message).join(", "),
      };
    }

    const draftOrderId = createOrderData.data?.draftOrderCreate?.draftOrder?.id;

    if (!draftOrderId) {
      return {
        success: false,
        error: "Erreur lors de la création du brouillon de commande",
      };
    }

    // Complete the draft order
    const completeDraftResponse = await admin.graphql(
      `#graphql
        mutation draftOrderComplete($id: ID!) {
          draftOrderComplete(id: $id) {
            draftOrder {
              id
              order {
                id
                name
              }
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
          id: draftOrderId,
        },
      },
    );

    const completeData = await completeDraftResponse.json();
    const completeErrors = completeData.data?.draftOrderComplete?.userErrors;

    if (completeErrors && completeErrors.length > 0) {
      return {
        success: false,
        error: completeErrors
          .map((e: { message: string }) => e.message)
          .join(", "),
      };
    }

    const orderName =
      completeData.data?.draftOrderComplete?.draftOrder?.order?.name;
    const orderId =
      completeData.data?.draftOrderComplete?.draftOrder?.order?.id;

    if (!orderId) {
      return {
        success: false,
        error: "Commande créée mais ID manquant",
      };
    }

    // CRITICAL: Set the subscription metafield on the ORDER (not draft order)
    // Draft order metafields don't transfer automatically
    const updateOrderMetafieldResponse = await admin.graphql(
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
            id: orderId,
            metafields: [
              {
                namespace: "custom",
                key: "subscriptions",
                type: "list.metaobject_reference",
                value: JSON.stringify([subscriptionId]),
              },
            ],
          },
        },
      },
    );

    const updateOrderData = await updateOrderMetafieldResponse.json();
    const updateOrderErrors = updateOrderData.data?.orderUpdate?.userErrors;

    if (updateOrderErrors && updateOrderErrors.length > 0) {
      return {
        success: false,
        error: `Commande créée mais erreur lors de l'ajout du metafield: ${updateOrderErrors.map((e: { message: string }) => e.message).join(", ")}`,
      };
    }

    return {
      success: true,
      message: `Commande de renouvellement ${orderName} créée avec succès. Le webhook va maintenant traiter le renouvellement.`,
      orderId,
    };
  } catch (error) {
    console.error("Error creating renewal order:", error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export default function RenewalOrderPage() {
  const { subscriptions } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const [selectedSubscription, setSelectedSubscription] =
    useState<Subscription | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showResults, setShowResults] = useState(false);

  const isSubmitting = navigation.state === "submitting";

  // Fetch variants when subscription is selected
  useEffect(() => {
    if (!selectedSubscription) {
      setVariants([]);
      setSelectedVariant("");
      return;
    }

    const fetchVariants = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/product-variants?productId=${encodeURIComponent(selectedSubscription.product.id)}`,
        );
        const data = await response.json();
        setVariants(data.variants || []);
        if (data.variants && data.variants.length > 0) {
          setSelectedVariant(data.variants[0].id);
        }
      } catch (error) {
        console.error("Error fetching variants:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchVariants();
  }, [selectedSubscription]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      submit(formData, { method: "post" });
    },
    [submit],
  );

  // Filter subscriptions based on search term
  const filteredSubscriptions = subscriptions.filter((sub) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      sub.subscriptionId.toLowerCase().includes(searchLower) ||
      sub.customer.displayName.toLowerCase().includes(searchLower) ||
      sub.customer.email.toLowerCase().includes(searchLower)
    );
  });

  const handleSelectSubscription = useCallback((sub: Subscription) => {
    setSelectedSubscription(sub);
    setSearchTerm(
      `${sub.subscriptionId} - ${sub.customer.displayName} (${sub.customer.email})`,
    );
    setShowResults(false);
  }, []);

  return (
    <s-page heading="Créer une commande de renouvellement">
      <div
        style={{
          padding: "1.25rem",
          boxShadow:
            "0rem 0.3125rem 0.3125rem -0.15625rem rgba(0, 0, 0, 0.03), 0rem 0.1875rem 0.1875rem -0.09375rem rgba(0, 0, 0, 0.02), 0rem 0.125rem 0.125rem -0.0625rem rgba(0, 0, 0, 0.02), 0rem 0.0625rem 0.0625rem -0.03125rem rgba(0, 0, 0, 0.03), 0rem 0.03125rem 0.03125rem 0rem rgba(0, 0, 0, 0.04), 0rem 0rem 0rem 0.0625rem rgba(0, 0, 0, 0.06)",
          borderRadius: "0.75rem",
          backgroundColor: "rgba(255, 255, 255, 1)",
        }}
      >
        <s-heading>Sélection de l&apos;abonnement</s-heading>
        <s-paragraph>
          Sélectionnez un abonnement actif et le variant de produit pour créer
          une commande de renouvellement.
        </s-paragraph>

        <Form method="post" onSubmit={handleSubmit}>
          <div style={{ marginTop: "20px" }}>
            <div style={{ marginBottom: "20px", position: "relative" }}>
              <label
                htmlFor="subscriptionSearch"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: "500",
                }}
              >
                Rechercher un abonnement *
              </label>
              <input
                id="subscriptionSearch"
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowResults(true);
                  if (!e.target.value) {
                    setSelectedSubscription(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                  }
                }}
                onFocus={() => setShowResults(true)}
                onBlur={() => {
                  // Small delay to allow click events on results to fire first
                  setTimeout(() => setShowResults(false), 200);
                }}
                placeholder="Chercher par ID d'abonnement, nom du client ou email..."
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: "4px",
                  border: "1px solid #ccc",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />

              {/* Search results dropdown */}
              {showResults &&
                searchTerm &&
                filteredSubscriptions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      backgroundColor: "white",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      marginTop: "4px",
                      maxHeight: "300px",
                      overflowY: "auto",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                      zIndex: 1000,
                    }}
                  >
                    {filteredSubscriptions.map((sub) => (
                      <div
                        key={sub.id}
                        role="button"
                        tabIndex={0}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSubscription(sub);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectSubscription(sub);
                          }
                        }}
                        style={{
                          padding: "12px",
                          borderBottom: "1px solid #eee",
                          cursor: "pointer",
                          transition: "background-color 0.2s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#f6f6f7";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "white";
                        }}
                      >
                        <div style={{ fontWeight: "500", marginBottom: "4px" }}>
                          {sub.subscriptionId}
                        </div>
                        <div style={{ fontSize: "13px", color: "#666" }}>
                          {sub.customer.displayName} ({sub.customer.email})
                        </div>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "#888",
                            marginTop: "2px",
                          }}
                        >
                          {sub.product.title} - {sub.renewalsCount}{" "}
                          renouvellement(s)
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {/* No results message */}
              {showResults &&
                searchTerm &&
                filteredSubscriptions.length === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      backgroundColor: "white",
                      border: "1px solid #ccc",
                      borderRadius: "4px",
                      marginTop: "4px",
                      padding: "12px",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                      zIndex: 1000,
                      color: "#666",
                    }}
                  >
                    Aucun abonnement trouvé
                  </div>
                )}

              {/* Hidden input for form submission */}
              <input
                type="hidden"
                name="subscriptionId"
                value={selectedSubscription?.id || ""}
              />
            </div>

            {/* Show selected subscription details */}
            {selectedSubscription && (
              <div
                style={{
                  marginBottom: "20px",
                  padding: "16px",
                  border: "1px solid #e1e3e5",
                  borderRadius: "8px",
                  backgroundColor: "#f6f6f7",
                }}
              >
                <h3 style={{ marginTop: 0, marginBottom: "12px" }}>
                  Détails de l&apos;abonnement
                </h3>
                <p style={{ margin: "4px 0" }}>
                  <strong>ID:</strong> {selectedSubscription.subscriptionId}
                </p>
                <p style={{ margin: "4px 0" }}>
                  <strong>Client:</strong>{" "}
                  {selectedSubscription.customer.displayName}
                </p>
                <p style={{ margin: "4px 0" }}>
                  <strong>Email:</strong> {selectedSubscription.customer.email}
                </p>
                <p style={{ margin: "4px 0" }}>
                  <strong>Produit:</strong> {selectedSubscription.product.title}
                </p>
                <p style={{ margin: "4px 0" }}>
                  <strong>Renouvellements:</strong>{" "}
                  {selectedSubscription.renewalsCount}
                </p>
              </div>
            )}

            {/* Variant selection */}
            {selectedSubscription && (
              <div style={{ marginBottom: "20px" }}>
                <label
                  htmlFor="variantId"
                  style={{
                    display: "block",
                    marginBottom: "8px",
                    fontWeight: "500",
                  }}
                >
                  Variant *
                </label>
                {loading ? (
                  <p>Chargement des variants...</p>
                ) : variants.length > 0 ? (
                  <select
                    id="variantId"
                    name="variantId"
                    value={selectedVariant}
                    onChange={(e) => setSelectedVariant(e.target.value)}
                    required
                    style={{
                      width: "100%",
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                    }}
                  >
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {variant.title} - ${variant.price} ({variant.issueCount}{" "}
                        numéros)
                      </option>
                    ))}
                  </select>
                ) : (
                  <p style={{ color: "#d72c0d" }}>
                    Aucun variant disponible pour ce produit
                  </p>
                )}
              </div>
            )}

            {/* Submit button */}
            <s-button
              type="submit"
              variant="primary"
              disabled={
                !selectedSubscription ||
                !selectedVariant ||
                loading ||
                isSubmitting
              }
              loading={isSubmitting}
            >
              {isSubmitting
                ? "Création en cours..."
                : "Créer la commande de renouvellement"}
            </s-button>
          </div>
        </Form>

        {/* Action feedback */}
        {actionData && (
          <div style={{ marginTop: "20px" }}>
            {actionData.success ? (
              <s-paragraph tone="success">
                Commande de renouvellement{" "}
                <a
                  href={`shopify:admin/orders/${actionData.orderId?.split("/").pop()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "#005bd3",
                    textDecoration: "none",
                    fontWeight: "500",
                  }}
                >
                  {actionData.message?.match(/#\d+/)?.[0] || ""}
                </a>{" "}
                créée avec succès. Le webhook va maintenant traiter le
                renouvellement.
              </s-paragraph>
            ) : (
              <s-paragraph tone="critical">
                Erreur: {actionData.error}
              </s-paragraph>
            )}
          </div>
        )}
      </div>
    </s-page>
  );
}
