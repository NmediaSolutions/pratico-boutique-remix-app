import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  Text,
  Divider,
  InlineStack,
  Badge,
  Box,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useState } from "react";

// Type pour les droits au numéro
interface IssueEntitlement {
  id: string;
  customer: string;
  magazineIssue: string;
  status: "Actif" | "Utilisé" | "Expiré";
}

// Type pour les champs d'un metaobject
interface MetaobjectField {
  key: string;
  value?: string;
  reference?: {
    id: string;
    displayName?: string;
  };
}

// Type pour un metaobject
interface MetaobjectNode {
  id: string;
  fields: MetaobjectField[];
}

function BlockExtension() {
  const { data } = useApi<"admin.order-details.block.render">();
  const [entitlements, setEntitlements] = useState<IssueEntitlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEntitlements() {
      try {
        // Récupérer l'ID de la commande depuis le contexte
        const orderId = data.selected[0]?.id;

        if (!orderId) {
          setLoading(false);
          return;
        }

        // Requête GraphQL pour récupérer les droits au numéro
        const response = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `
              query GetIssueEntitlements($type: String!, $first: Int!) {
                metaobjects(type: $type, first: $first) {
                  edges {
                    node {
                      id
                      fields {
                        key
                        value
                        reference {
                          ... on Customer {
                            id
                            displayName
                          }
                          ... on Metaobject {
                            id
                            displayName
                          }
                          ... on Order {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            `,
            variables: {
              type: "issue_entitlement",
              first: 50,
            },
          }),
        });

        const result = await response.json();

        if (result.errors) {
          setError("Erreur lors du chargement des droits");
          setLoading(false);
          return;
        }

        // Filtrer et formater les droits pour la commande actuelle
        const metaobjects = result.data?.metaobjects?.edges || [];
        const formattedEntitlements: IssueEntitlement[] = metaobjects
          .map((edge: { node: MetaobjectNode }) => {
            const fields = edge.node.fields;
            const customerField = fields.find((f) => f.key === "customer");
            const magazineField = fields.find(
              (f) => f.key === "magazine_issue",
            );
            const statusField = fields.find((f) => f.key === "status");
            const sourceOrderField = fields.find(
              (f) => f.key === "source_order",
            );

            // Filtrer uniquement les droits pour cette commande
            if (sourceOrderField?.reference?.id !== orderId) {
              return null;
            }

            return {
              id: edge.node.id,
              customer:
                customerField?.reference?.displayName || "Client non défini",
              magazineIssue:
                magazineField?.reference?.displayName || "Numéro non défini",
              status: statusField?.value || "Actif",
            };
          })
          .filter(Boolean);

        setEntitlements(formattedEntitlements);
        setLoading(false);
      } catch (err) {
        console.error("Erreur:", err);
        setError("Erreur lors du chargement des droits");
        setLoading(false);
      }
    }

    fetchEntitlements();
  }, [data]);

  // Fonction pour déterminer le tone du badge selon le statut
  const getStatusBadgeTone = (status: string) => {
    switch (status) {
      case "Actif":
        return "success";
      case "Utilisé":
        return "info";
      case "Expiré":
        return "warning";
      default:
        return "info";
    }
  };

  return (
    <AdminBlock title="Droits au numéro">
      <BlockStack gap="base">
        {loading && <Text>Chargement des droits au numéro...</Text>}

        {error && <Text tone="critical">{error}</Text>}

        {!loading && !error && entitlements.length === 0 && (
          <Box padding="base">
            <Text tone="subdued">
              Aucun droit au numéro généré pour cette commande
            </Text>
          </Box>
        )}

        {!loading && !error && entitlements.length > 0 && (
          <BlockStack gap="base">
            <Divider />
            {/* En-têtes du tableau */}
            <InlineStack gap="base" blockAlignment="center">
              <Box minInlineSize="25%">
                <Text fontWeight="bold">Client</Text>
              </Box>
              <Box minInlineSize="35%">
                <Text fontWeight="bold">Numéro de magazine</Text>
              </Box>
              <Box minInlineSize="20%">
                <Text fontWeight="bold">Statut</Text>
              </Box>
            </InlineStack>

            <Divider />

            {/* Lignes de données */}
            {entitlements.map((entitlement) => (
              <BlockStack key={entitlement.id} gap="base">
                <InlineStack gap="base" blockAlignment="center">
                  <Box minInlineSize="25%">
                    <Text>{entitlement.customer}</Text>
                  </Box>
                  <Box minInlineSize="35%">
                    <Text>{entitlement.magazineIssue}</Text>
                  </Box>
                  <Box minInlineSize="20%">
                    <Badge tone={getStatusBadgeTone(entitlement.status)}>
                      {entitlement.status}
                    </Badge>
                  </Box>
                </InlineStack>
                <Divider />
              </BlockStack>
            ))}
          </BlockStack>
        )}
      </BlockStack>
    </AdminBlock>
  );
}

export default reactExtension("admin.order-details.block.render", () => (
  <BlockExtension />
));
