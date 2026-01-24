import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import * as iconv from "iconv-lite";

interface MagazineIssue {
  id: string;
  displayName: string;
  title: string;
  status: string;
}

interface LoaderData {
  magazines: MagazineIssue[];
  hasNextPage: boolean;
  endCursor: string | null;
}

interface ActionData {
  count: number;
  magazineTitle: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  // Fetch all magazine issues
  const response = await admin.graphql(
    `#graphql
      query GetMagazineIssues($cursor: String) {
        metaobjects(
          type: "magazine_issue"
          first: 50
          after: $cursor
        ) {
          edges {
            node {
              id
              displayName
              fields {
                key
                value
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      variables: {
        cursor,
      },
    },
  );

  const responseJson = await response.json();
  const data = responseJson.data?.metaobjects;

  interface MetaobjectField {
    key: string;
    value?: string;
  }

  interface MetaobjectEdge {
    node: {
      id: string;
      displayName?: string;
      fields: MetaobjectField[];
    };
  }

  const allMagazinesFromAPI: MagazineIssue[] =
    data?.edges?.map((edge: MetaobjectEdge) => {
      const titleField = edge.node.fields.find((f) => f.key === "title");
      const statusField = edge.node.fields.find((f) => f.key === "status");
      return {
        id: edge.node.id,
        displayName: edge.node.displayName || titleField?.value || "Sans titre",
        title: titleField?.value || "Sans titre",
        status: statusField?.value || "",
      };
    }) || [];

  // Filter to show only magazines with status "Planifié"
  const magazines = allMagazinesFromAPI.filter(
    (mag) => mag.status === "Planifié",
  );

  return {
    magazines,
    hasNextPage: data?.pageInfo?.hasNextPage || false,
    endCursor: data?.pageInfo?.endCursor || null,
  };
};

// Helper function to generate CSV
async function generateCSV(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  magazineId: string,
  magazineTitle: string,
) {
  interface EntitlementField {
    key: string;
    value?: string;
    reference?: {
      id: string;
    };
  }

  interface EntitlementEdge {
    node: {
      id: string;
      fields: EntitlementField[];
    };
  }

  interface EntitlementData {
    metaobjects: {
      edges: EntitlementEdge[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  }

  // Collect all entitlements with customer references
  const allEntitlements: Array<{ customerId: string }> = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const graphqlResponse = await admin.graphql(
      `#graphql
        query GetEntitlements($cursor: String) {
          metaobjects(
            type: "issue_entitlement"
            first: 250
            after: $cursor
          ) {
            edges {
              node {
                id
                fields {
                  key
                  value
                  reference {
                    ... on Metaobject {
                      id
                    }
                    ... on Customer {
                      id
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      {
        variables: {
          cursor,
        },
      },
    );

    const entitlementResponseJson = await graphqlResponse.json();
    const entitlementData = entitlementResponseJson.data as
      | EntitlementData
      | undefined;

    if (entitlementData?.metaobjects?.edges) {
      entitlementData.metaobjects.edges.forEach((edge: EntitlementEdge) => {
        const magazineField = edge.node.fields.find(
          (f: EntitlementField) => f.key === "magazine_issue",
        );
        const statusField = edge.node.fields.find(
          (f: EntitlementField) => f.key === "status",
        );
        const customerField = edge.node.fields.find(
          (f: EntitlementField) => f.key === "customer",
        );

        if (
          magazineField?.reference?.id === magazineId &&
          statusField?.value === "Actif" &&
          customerField?.reference?.id
        ) {
          allEntitlements.push({
            customerId: customerField.reference.id,
          });
        }
      });
    }

    hasNextPage = entitlementData?.metaobjects?.pageInfo?.hasNextPage || false;
    cursor = entitlementData?.metaobjects?.pageInfo?.endCursor || null;
  }

  if (allEntitlements.length === 0) {
    return new Response("Aucun destinataire trouvé pour ce magazine", {
      status: 404,
    });
  }

  // Fetch customer details in batches
  const csvRows: string[] = [];
  const batchSize = 50;

  for (let i = 0; i < allEntitlements.length; i += batchSize) {
    const batch = allEntitlements.slice(i, i + batchSize);
    const customerIds = batch.map((e) => e.customerId);

    // Build GraphQL query for batch
    const customerQuery = `#graphql
      query GetCustomers($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Customer {
            id
            firstName
            lastName
            locale
            defaultAddress {
              firstName
              lastName
              company
              address1
              address2
              city
              provinceCode
              zip
              countryCode
            }
            honorificTitle: metafield(namespace: "custom", key: "honorific_title") {
              value
            }
            languagePreference: metafield(namespace: "custom", key: "language_preference") {
              value
            }
          }
        }
      }
    `;

    const customerResponse = await admin.graphql(customerQuery, {
      variables: { ids: customerIds },
    });

    interface CustomerData {
      id: string;
      firstName?: string;
      lastName?: string;
      locale?: string;
      defaultAddress?: {
        firstName?: string;
        lastName?: string;
        company?: string;
        address1?: string;
        address2?: string;
        city?: string;
        provinceCode?: string;
        zip?: string;
        countryCode?: string;
      };
      honorificTitle?: {
        value?: string;
      };
      languagePreference?: {
        value?: string;
      };
    }

    const customerData = await customerResponse.json();
    const customers = customerData.data?.nodes || [];

    customers.forEach((customer: CustomerData) => {
      if (!customer) return;

      // Get address - use defaultAddress
      const address = customer.defaultAddress;

      if (!address) {
        console.warn(`No address found for customer ${customer.id}`);
        return;
      }

      // Extract customer ID number
      const customerIdMatch = customer.id.match(/\d+$/);
      const customerId = customerIdMatch ? customerIdMatch[0] : customer.id;

      // Get metafield values
      const honorificTitle = customer.honorificTitle?.value || "";

      // Determine language: 1 = French (default), 2 = English
      let language = "1";
      const langPref = customer.languagePreference?.value;
      if (langPref === "2" || langPref === "en") {
        language = "2";
      } else if (
        customer.locale &&
        customer.locale.toLowerCase().startsWith("en")
      ) {
        language = "2";
      }

      // Format date - use current date since createdAt is not available on metaobjects
      const dateStr = new Date().toISOString().slice(0, 16).replace("T", " ");

      // Build CSV row with all 20 columns
      const row = [
        customerId, // 1. information client
        honorificTitle, // 2. prefix
        address.firstName || "", // 3. prenom
        address.lastName || "", // 4. nom de famille
        `${address.firstName || ""} ${address.lastName || ""}`.trim(), // 5. nom
        address.company || "", // 6. compagnie
        address.address1 || "", // 7. addresse 1
        address.address2 || "", // 8. appt/suite
        address.city || "", // 9. ville
        address.provinceCode || "", // 10. province
        address.zip || "", // 11. code postal
        address.countryCode || "CA", // 12. pays
        "1", // 13. nbr copies
        "", // 14. source
        language, // 15. langue
        "", // 16. Lettre de bienvenue (MVP - empty)
        "", // 17. Relance (MVP - empty)
        "", // 18. Lettre de bienvenue (Offre or)
        "", // 19. Relance (Offre or)
        dateStr, // 20. Date abonnement
      ];

      csvRows.push(row.join(";"));
    });
  }

  // Add totals footer (MVP - all zeros)
  csvRows.push(";;;;;;;;;;;;0;;;;;"); // Total welcome letters = 0
  csvRows.push(";;;;;;;;;;;;0;;;;;"); // Total 1st reminders = 0
  csvRows.push(";;;;;;;;;;;;0;;;;;"); // Total 2nd reminders = 0

  // Combine all rows with header
  const header = [
    "information client",
    "prefix",
    "prenom",
    "nom de famille",
    "nom",
    "compagnie",
    "addresse 1",
    "appt/suite",
    "ville",
    "province",
    "code postal",
    "pays",
    "nbr copies",
    "source",
    "langue",
    "Lettre de bienvenue",
    "Relance",
    "Lettre de bienvenue (Offre or)",
    "Relance (Offre or)",
    "Date abonnement",
  ].join(";");

  const csvContent = [header, ...csvRows].join("\n");

  // Convert to uppercase and remove backslashes
  const csvUppercase = csvContent.toUpperCase().replace(/\\/g, "");

  // Encode to ISO-8859-1
  const csvBuffer = iconv.encode(csvUppercase, "ISO-8859-1");

  // Generate filename with date
  const today = new Date().toISOString().slice(0, 10);
  const safeMagazineTitle = magazineTitle.replace(/[^a-zA-Z0-9-]/g, "-");
  const filename = `pratico-${safeMagazineTitle}-${today}.csv`;

  // Return CSV data as base64 for client-side download
  const base64Data = Buffer.from(csvBuffer).toString("base64");

  return {
    success: true,
    filename,
    data: base64Data,
    contentType: "text/csv; charset=ISO-8859-1",
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;
  const magazineId = formData.get("magazineId") as string;
  const magazineTitle = formData.get("magazineTitle") as string;

  if (!magazineId) {
    return {
      count: 0,
      magazineTitle: "",
      error: "Aucun numéro de magazine sélectionné",
    };
  }

  // Handle CSV generation
  if (actionType === "generate-csv") {
    return await generateCSV(admin, magazineId, magazineTitle);
  }

  interface EntitlementField {
    key: string;
    value?: string;
    reference?: {
      id: string;
    };
  }

  interface EntitlementEdge {
    node: {
      id: string;
      fields: EntitlementField[];
    };
  }

  interface EntitlementData {
    metaobjects: {
      edges: EntitlementEdge[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  }

  // Count all active entitlements for this magazine with pagination
  let totalCount = 0;
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const graphqlResponse = await admin.graphql(
      `#graphql
        query CountEntitlements($cursor: String) {
          metaobjects(
            type: "issue_entitlement"
            first: 250
            after: $cursor
          ) {
            edges {
              node {
                id
                fields {
                  key
                  value
                  reference {
                    ... on Metaobject {
                      id
                    }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      {
        variables: {
          cursor,
        },
      },
    );

    const entitlementResponseJson = await graphqlResponse.json();
    const entitlementData = entitlementResponseJson.data as
      | EntitlementData
      | undefined;

    if (entitlementData?.metaobjects?.edges) {
      // Filter entitlements that match the magazine and have "Actif" status
      const matchingEntitlements = entitlementData.metaobjects.edges.filter(
        (edge) => {
          const magazineField = edge.node.fields.find(
            (f) => f.key === "magazine_issue",
          );
          const statusField = edge.node.fields.find((f) => f.key === "status");

          return (
            magazineField?.reference?.id === magazineId &&
            statusField?.value === "Actif"
          );
        },
      );

      totalCount += matchingEntitlements.length;
    }

    hasNextPage = entitlementData?.metaobjects?.pageInfo?.hasNextPage || false;
    cursor = entitlementData?.metaobjects?.pageInfo?.endCursor || null;
  }

  return {
    count: totalCount,
    magazineTitle,
  };
};

export default function ShippingListPage() {
  const loaderData = useLoaderData<LoaderData>();
  const { magazines, hasNextPage, endCursor } = loaderData;
  const fetcher = useFetcher<ActionData>();
  const csvFetcher = useFetcher();
  const [selectedMagazineId, setSelectedMagazineId] = useState("");
  const [allMagazines, setAllMagazines] = useState<MagazineIssue[]>(magazines);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const isLoadingCount =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const isGeneratingCSV =
    csvFetcher.state === "submitting" || csvFetcher.state === "loading";

  const handleMagazineChange = (magazineId: string) => {
    setSelectedMagazineId(magazineId);
    if (magazineId) {
      const magazine = allMagazines.find((m) => m.id === magazineId);
      if (magazine) {
        const formData = new FormData();
        formData.append("magazineId", magazineId);
        formData.append("magazineTitle", magazine.title);
        fetcher.submit(formData, { method: "POST" });
      }
    }
  };

  const loadMoreMagazines = () => {
    if (hasNextPage && endCursor) {
      fetch(`/app/shipping-list?cursor=${endCursor}`)
        .then((res) => res.json())
        .then((data: LoaderData) => {
          setAllMagazines([...allMagazines, ...data.magazines]);
        });
    }
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat("fr-FR").format(num);
  };

  const handleGenerateCSV = () => {
    setShowConfirmDialog(true);
  };

  const confirmGenerateCSV = () => {
    setShowConfirmDialog(false);
    const magazine = allMagazines.find((m) => m.id === selectedMagazineId);
    if (magazine) {
      const formData = new FormData();
      formData.append("actionType", "generate-csv");
      formData.append("magazineId", selectedMagazineId);
      formData.append("magazineTitle", magazine.title);
      csvFetcher.submit(formData, { method: "POST" });
    }
  };

  const cancelGenerateCSV = () => {
    setShowConfirmDialog(false);
  };

  // Handle CSV download when data is received
  useEffect(() => {
    interface CSVResponse {
      success: boolean;
      filename: string;
      data: string;
      contentType: string;
    }

    if (csvFetcher.data && (csvFetcher.data as CSVResponse).success) {
      const csvData = csvFetcher.data as CSVResponse;

      // Decode base64 data
      const binaryString = atob(csvData.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create blob and download
      const blob = new Blob([bytes], { type: csvData.contentType });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvData.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }
  }, [csvFetcher.data]);

  return (
    <s-page heading="Générateur de liste d'expédition">
      <s-section>
        <s-paragraph>
          Sélectionnez un numéro de magazine planifié pour voir le nombre total
          d&apos;abonnés qui ont droit à ce numéro.
        </s-paragraph>

        {allMagazines.length === 0 && (
          <div
            style={{
              marginTop: "20px",
              padding: "20px",
              backgroundColor: "#fff4e6",
              borderRadius: "8px",
              border: "1px solid #ffa726",
            }}
          >
            <s-paragraph>
              <strong>
                Aucun magazine avec le statut &quot;Planifié&quot; trouvé
              </strong>
            </s-paragraph>
            <s-paragraph>Pour utiliser cette fonctionnalité :</s-paragraph>
            <ol style={{ marginLeft: "20px", marginTop: "10px" }}>
              <li style={{ marginBottom: "8px" }}>
                Exécutez la configuration sur la{" "}
                <a href="/app/setup" style={{ color: "#0066cc" }}>
                  page Setup
                </a>{" "}
                pour ajouter le champ &quot;Statut&quot;
              </li>
              <li style={{ marginBottom: "8px" }}>
                Dans Shopify Admin, allez dans vos &quot;Numéros de
                magazine&quot;
              </li>
              <li style={{ marginBottom: "8px" }}>
                Modifiez chaque numéro et définissez le statut à
                &quot;Planifié&quot;
              </li>
            </ol>
          </div>
        )}

        <div style={{ marginTop: "20px" }}>
          <s-stack direction="block" gap="base">
            <div>
              <label
                htmlFor="magazine-select"
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: "500",
                }}
              >
                Numéro de magazine
              </label>
              <select
                id="magazine-select"
                value={selectedMagazineId}
                onChange={(e) => handleMagazineChange(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: "14px",
                  border: "1px solid #c9cccf",
                  borderRadius: "8px",
                  backgroundColor: "white",
                  cursor: "pointer",
                }}
              >
                <option value="">-- Sélectionnez un numéro --</option>
                {allMagazines.map((magazine) => (
                  <option key={magazine.id} value={magazine.id}>
                    {magazine.displayName}
                  </option>
                ))}
              </select>
            </div>

            {hasNextPage && (
              <s-button onClick={loadMoreMagazines} variant="tertiary">
                Charger plus de magazines
              </s-button>
            )}
          </s-stack>
        </div>

        {isLoadingCount && (
          <div style={{ marginTop: "20px" }}>
            <s-spinner />
            <s-paragraph>Calcul en cours...</s-paragraph>
          </div>
        )}

        {fetcher.data && !isLoadingCount && (
          <div
            style={{
              marginTop: "20px",
              padding: "20px",
              backgroundColor: "#f9fafb",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
            }}
          >
            <s-stack direction="block" gap="base">
              <s-heading>Résultat</s-heading>
              <s-paragraph>
                <strong>Numéro :</strong> {fetcher.data.magazineTitle}
              </s-paragraph>
              <s-paragraph>
                <strong>
                  {formatNumber(fetcher.data.count)} destinataires prévus
                </strong>
              </s-paragraph>

              <div style={{ marginTop: "16px" }}>
                <s-button
                  onClick={handleGenerateCSV}
                  variant="primary"
                  disabled={isGeneratingCSV}
                >
                  {isGeneratingCSV
                    ? "Génération en cours..."
                    : "Générer le fichier de test (CSV)"}
                </s-button>
              </div>

              <div
                style={{
                  marginTop: "12px",
                  padding: "12px",
                  backgroundColor: "#e3f2fd",
                  borderRadius: "6px",
                  fontSize: "13px",
                }}
              >
                <s-paragraph>
                  <strong>Note :</strong> Si l&apos;adresse de livraison est
                  manquante, l&apos;adresse de facturation sera utilisée.
                </s-paragraph>
              </div>
            </s-stack>
          </div>
        )}

        {/* Confirmation Dialog */}
        {showConfirmDialog && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              style={{
                backgroundColor: "white",
                padding: "24px",
                borderRadius: "12px",
                maxWidth: "500px",
                width: "90%",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
              }}
            >
              <s-heading>Confirmer la génération</s-heading>
              <div style={{ marginTop: "16px", marginBottom: "24px" }}>
                <s-paragraph>
                  Voulez-vous vraiment générer le fichier CSV pour ce magazine ?
                </s-paragraph>
                <div style={{ marginTop: "8px" }}>
                  <s-paragraph>
                    Le fichier contiendra {fetcher.data?.count || 0}{" "}
                    destinataires.
                  </s-paragraph>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "flex-end",
                }}
              >
                <s-button onClick={cancelGenerateCSV} variant="secondary">
                  Annuler
                </s-button>
                <s-button onClick={confirmGenerateCSV} variant="primary">
                  Générer le CSV
                </s-button>
              </div>
            </div>
          </div>
        )}

        {!selectedMagazineId && !fetcher.data && (
          <div style={{ marginTop: "20px" }}>
            <s-paragraph>
              Veuillez sélectionner un numéro de magazine pour voir le nombre de
              destinataires.
            </s-paragraph>
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="À propos">
        <s-paragraph>
          Cette page vous permet de valider rapidement l&apos;envergure
          d&apos;un envoi avant de générer le fichier d&apos;expédition complet.
        </s-paragraph>
        <s-paragraph>
          Seuls les droits au numéro avec le statut &quot;Actif&quot; sont
          comptabilisés.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
