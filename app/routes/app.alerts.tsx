import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form } from "react-router";
import { authenticate } from "../shopify.server";

interface AlertNode {
  id: string;
  alertType?: {
    value: string;
  };
  orderType?: {
    value: string;
  };
  requiredIssues?: {
    value: string;
  };
  availableIssues?: {
    value: string;
  };
  alertDate?: {
    value: string;
  };
  status?: {
    value: string;
  };
  order?: {
    reference?: {
      id: string;
      name: string;
    };
  };
  customer?: {
    reference?: {
      id: string;
      displayName: string;
    };
  };
  product?: {
    reference?: {
      id: string;
      title: string;
    };
  };
  subscription?: {
    reference?: {
      id: string;
      subscriptionId?: {
        value: string;
      };
    };
  };
}

interface Alert {
  id: string;
  alertType: string;
  orderType: string;
  requiredIssues: string;
  availableIssues: string;
  alertDate: string;
  status: string;
  order?: {
    id: string;
    name: string;
  };
  customer?: {
    id: string;
    displayName: string;
  };
  product?: {
    id: string;
    title: string;
  };
  subscription?: {
    id: string;
    subscriptionId: string;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch all magazine issue alerts
  const alertsResponse = await admin.graphql(
    `#graphql
      query getAlerts {
        metaobjects(type: "magazine_issue_alert", first: 100) {
          edges {
            node {
              id
              alertType: field(key: "alert_type") {
                value
              }
              orderType: field(key: "order_type") {
                value
              }
              requiredIssues: field(key: "required_issues") {
                value
              }
              availableIssues: field(key: "available_issues") {
                value
              }
              alertDate: field(key: "alert_date") {
                value
              }
              status: field(key: "status") {
                value
              }
              order: field(key: "order") {
                reference {
                  ... on Order {
                    id
                    name
                  }
                }
              }
              customer: field(key: "customer") {
                reference {
                  ... on Customer {
                    id
                    displayName
                  }
                }
              }
              product: field(key: "product") {
                reference {
                  ... on Product {
                    id
                    title
                  }
                }
              }
              subscription: field(key: "subscription") {
                reference {
                  ... on Metaobject {
                    id
                    subscriptionId: field(key: "subscription_id") {
                      value
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

  const alertsData = await alertsResponse.json();
  const alerts =
    alertsData.data?.metaobjects?.edges?.map((edge: { node: AlertNode }) => ({
      id: edge.node.id,
      alertType: edge.node.alertType?.value || "",
      orderType: edge.node.orderType?.value || "",
      requiredIssues: edge.node.requiredIssues?.value || "0",
      availableIssues: edge.node.availableIssues?.value || "0",
      alertDate: edge.node.alertDate?.value || "",
      status: edge.node.status?.value || "",
      order: edge.node.order?.reference,
      customer: edge.node.customer?.reference,
      product: edge.node.product?.reference,
      subscription: edge.node.subscription?.reference
        ? {
            id: edge.node.subscription.reference.id,
            subscriptionId:
              edge.node.subscription.reference.subscriptionId?.value || "",
          }
        : undefined,
    })) || [];

  return { alerts };
};

export const action = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const alertId = formData.get("alertId") as string;
  const newStatus = formData.get("status") as string;

  if (!alertId || !newStatus) {
    return { success: false, error: "Missing parameters" };
  }

  // Update the alert status
  const updateResponse = await admin.graphql(
    `#graphql
      mutation updateAlert($id: ID!, $metaobject: MetaobjectUpdateInput!) {
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
        id: alertId,
        metaobject: {
          fields: [
            {
              key: "status",
              value: newStatus,
            },
          ],
        },
      },
    },
  );

  const updateData = await updateResponse.json();
  const errors = updateData.data?.metaobjectUpdate?.userErrors;

  if (errors && errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true };
};

export default function AlertsPage() {
  const data = useLoaderData<typeof loader>();
  const alerts = data?.alerts || [];

  const unresolvedAlerts = alerts.filter(
    (alert: Alert) => alert.status === "unresolved",
  );
  const resolvedAlerts = alerts.filter(
    (alert: Alert) => alert.status === "resolved",
  );
  const ignoredAlerts = alerts.filter(
    (alert: Alert) => alert.status === "ignored",
  );

  const formatDate = (dateString: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString("fr-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getAlertTypeLabel = (type: string) => {
    return type === "no_issues"
      ? "Aucun numéro disponible"
      : "Numéros insuffisants";
  };

  const getOrderTypeLabel = (type: string) => {
    return type === "new_order" ? "Nouvelle commande" : "Renouvellement";
  };

  const renderAlertCard = (alert: Alert) => (
    <div
      key={alert.id}
      style={{
        marginBottom: "20px",
        padding: "20px",
        backgroundColor: "#fff",
        borderRadius: "8px",
        border: "1px solid #e1e3e5",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <s-badge
          tone={alert.alertType === "no_issues" ? "critical" : "caution"}
        >
          {getAlertTypeLabel(alert.alertType)}
        </s-badge>{" "}
        <s-badge tone="info">{getOrderTypeLabel(alert.orderType)}</s-badge>
      </div>

      <s-heading>
        Numéros requis: {alert.requiredIssues} / Disponibles:{" "}
        {alert.availableIssues}
      </s-heading>

      <s-paragraph>Date: {formatDate(alert.alertDate)}</s-paragraph>

      <s-divider />

      <div style={{ marginTop: "12px", marginBottom: "12px" }}>
        {alert.order && (
          <s-paragraph>
            <strong>Commande:</strong> {alert.order.name}
          </s-paragraph>
        )}
        {alert.customer && (
          <s-paragraph>
            <strong>Client:</strong> {alert.customer.displayName}
          </s-paragraph>
        )}
        {alert.product && (
          <s-paragraph>
            <strong>Produit:</strong> {alert.product.title}
          </s-paragraph>
        )}
        {alert.subscription && (
          <s-paragraph>
            <strong>Abonnement:</strong> {alert.subscription.subscriptionId}
          </s-paragraph>
        )}
      </div>

      {alert.status === "unresolved" && (
        <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
          <Form method="post">
            <input type="hidden" name="alertId" value={alert.id} />
            <input type="hidden" name="status" value="resolved" />
            <s-button type="submit">Marquer comme résolu</s-button>
          </Form>
          <Form method="post">
            <input type="hidden" name="alertId" value={alert.id} />
            <input type="hidden" name="status" value="ignored" />
            <s-button type="submit">Ignorer</s-button>
          </Form>
        </div>
      )}
    </div>
  );

  return (
    <s-page heading="Alertes - Numéros de magazine">
      <s-section>
        <s-paragraph>
          {unresolvedAlerts.length} alerte(s) non résolue(s)
        </s-paragraph>

        {unresolvedAlerts.length > 0 && (
          <div style={{ marginTop: "24px" }}>
            <s-heading>Non résolues ({unresolvedAlerts.length})</s-heading>
            <div style={{ marginTop: "12px" }}>
              {unresolvedAlerts.map(renderAlertCard)}
            </div>
          </div>
        )}

        {unresolvedAlerts.length === 0 && (
          <div
            style={{
              marginTop: "24px",
              padding: "40px",
              textAlign: "center",
              backgroundColor: "#f9fafb",
              borderRadius: "8px",
            }}
          >
            <s-heading>Aucune alerte non résolue</s-heading>
            <s-paragraph>
              Toutes les alertes ont été traitées. Les nouvelles alertes
              apparaîtront ici.
            </s-paragraph>
          </div>
        )}

        {resolvedAlerts.length > 0 && (
          <div style={{ marginTop: "24px" }}>
            <s-heading>Résolues ({resolvedAlerts.length})</s-heading>
            <div style={{ marginTop: "12px" }}>
              {resolvedAlerts.map(renderAlertCard)}
            </div>
          </div>
        )}

        {ignoredAlerts.length > 0 && (
          <div style={{ marginTop: "24px" }}>
            <s-heading>Ignorées ({ignoredAlerts.length})</s-heading>
            <div style={{ marginTop: "12px" }}>
              {ignoredAlerts.map(renderAlertCard)}
            </div>
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="À propos">
        <s-paragraph>
          Cette page affiche les alertes générées lorsqu&apos;il n&apos;y a pas
          assez de numéros de magazine disponibles pour les commandes.
        </s-paragraph>
        <s-paragraph>
          Les alertes sont créées automatiquement lors du traitement des
          commandes payées.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
