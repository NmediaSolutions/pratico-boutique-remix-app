import { Form, useActionData, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const messages: string[] = [];

  // --- DÉFINITION 1 : NUMÉRO DE MAGAZINE ---
  const TYPE_MAGAZINE = "magazine_issue";
  let magazineDefinitionId = ""; // On va stocker l'ID ici

  try {
    // 1. Vérification Magazine
    const checkMagazine = await admin.graphql(
      `#graphql
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            type
            displayNameKey
            fieldDefinitions {
              key
            }
          }
        }
      `,
      { variables: { type: TYPE_MAGAZINE } },
    );
    const jsonCheckMag = await checkMagazine.json();

    if (jsonCheckMag.data?.metaobjectDefinitionByType) {
      magazineDefinitionId = jsonCheckMag.data.metaobjectDefinitionByType.id;

      // Vérifier si le champ "associated_products" existe
      const existingFields =
        jsonCheckMag.data.metaobjectDefinitionByType.fieldDefinitions;
      const hasProductsField = existingFields.some(
        (field: { key: string }) => field.key === "associated_products",
      );
      const hasStatusField = existingFields.some(
        (field: { key: string }) => field.key === "status",
      );

      // Vérifier si displayNameKey est déjà défini à "title"
      const currentDisplayNameKey =
        jsonCheckMag.data.metaobjectDefinitionByType.displayNameKey;
      const needsDisplayNameUpdate = currentDisplayNameKey !== "title";

      if (!hasProductsField || !hasStatusField || needsDisplayNameUpdate) {
        const updates = [];

        // Update displayNameKey if needed
        if (needsDisplayNameUpdate) {
          const updateDisplayName = await admin.graphql(
            `#graphql
              mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
                metaobjectDefinitionUpdate(id: $id, definition: $definition) {
                  metaobjectDefinition { id }
                  userErrors { field, message }
                }
              }
            `,
            {
              variables: {
                id: magazineDefinitionId,
                definition: {
                  displayNameKey: "title",
                },
              },
            },
          );
          const jsonUpdateDisplayName = await updateDisplayName.json();
          const displayNameErrors =
            jsonUpdateDisplayName.data?.metaobjectDefinitionUpdate?.userErrors;

          if (displayNameErrors && displayNameErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: displayNameErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push('DisplayNameKey configuré sur "title"');
        }

        // Add associated_products field if needed
        if (!hasProductsField) {
          const addProductsField = await admin.graphql(
            `#graphql
              mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
                metaobjectDefinitionUpdate(id: $id, definition: $definition) {
                  metaobjectDefinition { id }
                  userErrors { field, message }
                }
              }
            `,
            {
              variables: {
                id: magazineDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: "Produits associés",
                      key: "associated_products",
                      type: "list.product_reference",
                      description:
                        "Liste des produits auxquels ce numéro de magazine est associé",
                    },
                  },
                },
              },
            },
          );
          const jsonAddProducts = await addProductsField.json();
          const productsErrors =
            jsonAddProducts.data?.metaobjectDefinitionUpdate?.userErrors;

          if (productsErrors && productsErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: productsErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push('Champ "Produits associés" ajouté');
        }

        // Add status field if needed
        if (!hasStatusField) {
          const addStatusField = await admin.graphql(
            `#graphql
              mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
                metaobjectDefinitionUpdate(id: $id, definition: $definition) {
                  metaobjectDefinition { id }
                  userErrors { field, message }
                }
              }
            `,
            {
              variables: {
                id: magazineDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: "Statut",
                      key: "status",
                      type: "single_line_text_field",
                      description: "Statut du numéro de magazine",
                      validations: [
                        {
                          name: "choices",
                          value: JSON.stringify(["Planifié", "Envoyé"]),
                        },
                      ],
                    },
                  },
                },
              },
            },
          );
          const jsonAddStatus = await addStatusField.json();
          const statusErrors =
            jsonAddStatus.data?.metaobjectDefinitionUpdate?.userErrors;

          if (statusErrors && statusErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: statusErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push('Champ "Statut" ajouté');
        }

        messages.push(`Magazine : ${updates.join(", ")}`);
      } else {
        messages.push(`Magazine : Déjà configuré avec tous les champs`);
      }
    } else {
      // Création Magazine
      const createMagazine = await admin.graphql(
        `#graphql
          mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
            metaobjectDefinitionCreate(definition: $definition) {
              metaobjectDefinition { id }
              userErrors { field, message }
            }
          }
        `,
        {
          variables: {
            definition: {
              name: "Numéro de magazine",
              type: TYPE_MAGAZINE,
              displayNameKey: "title",
              fieldDefinitions: [
                {
                  name: "Titre du numéro",
                  key: "title",
                  type: "single_line_text_field",
                },
                {
                  name: "Code de parution",
                  key: "publication_code",
                  type: "single_line_text_field",
                },
                {
                  name: "Date d'exportation",
                  key: "export_date",
                  type: "date_time",
                },
                {
                  name: "Produits associés",
                  key: "associated_products",
                  type: "list.product_reference",
                  description:
                    "Liste des produits auxquels ce numéro de magazine est associé",
                },
                {
                  name: "Statut",
                  key: "status",
                  type: "single_line_text_field",
                  description: "Statut du numéro de magazine",
                  validations: [
                    {
                      name: "choices",
                      value: JSON.stringify(["Planifié", "Envoyé"]),
                    },
                  ],
                },
              ],
            },
          },
        },
      );
      const jsonCreateMag = await createMagazine.json();
      const errors = jsonCreateMag.data?.metaobjectDefinitionCreate?.userErrors;

      if (errors && errors.length > 0) {
        return new Response(JSON.stringify({ success: false, errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      messages.push(`Magazine : Créé avec succès`);
      // IMPORTANT : On récupère le nouvel ID
      magazineDefinitionId =
        jsonCreateMag.data.metaobjectDefinitionCreate.metaobjectDefinition.id;
    }

    // --- MÉTAFIELD PRODUCT : NUMÉROS DE MAGAZINE ASSOCIÉS ---
    // Crée la relation bidirectionnelle avec les numéros de magazine
    const checkProductMetafield = await admin.graphql(
      `#graphql
        query {
          metafieldDefinitions(first: 1, ownerType: PRODUCT, key: "magazine_issues", namespace: "custom") {
            edges {
              node { id }
            }
          }
        }
      `,
    );

    const jsonCheckProductMF = await checkProductMetafield.json();

    if (jsonCheckProductMF.data?.metafieldDefinitions?.edges?.length > 0) {
      messages.push(`Métafield product (Numéros de magazine) : Déjà configuré`);
    } else {
      const createProductMetafield = await admin.graphql(
        `#graphql
          mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id, name }
              userErrors { field, message }
            }
          }
        `,
        {
          variables: {
            definition: {
              name: "Numéros de magazine",
              namespace: "custom",
              key: "magazine_issues",
              description:
                "Liste des numéros de magazine associés à ce produit (relation bidirectionnelle)",
              type: "list.metaobject_reference",
              ownerType: "PRODUCT",
              pin: true,
              validations: [
                {
                  name: "metaobject_definition_id",
                  value: magazineDefinitionId,
                },
              ],
            },
          },
        },
      );

      const jsonCreateProductMF = await createProductMetafield.json();
      const productMFErrors =
        jsonCreateProductMF.data?.metafieldDefinitionCreate?.userErrors;

      if (productMFErrors && productMFErrors.length > 0) {
        return new Response(
          JSON.stringify({ success: false, errors: productMFErrors }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      messages.push(
        `Métafield product (Numéros de magazine) : Créé avec succès`,
      );
    }

    // --- MÉTAFIELD VARIANT : NOMBRE DE NUMÉROS ---
    // Indique combien de numéros accorder lors de l'achat de ce variant
    const checkVariantMetafield = await admin.graphql(
      `#graphql
        query {
          metafieldDefinitions(first: 1, ownerType: PRODUCTVARIANT, key: "issue_count", namespace: "custom") {
            edges {
              node { id }
            }
          }
        }
      `,
    );

    const jsonCheckVariantMF = await checkVariantMetafield.json();

    if (jsonCheckVariantMF.data?.metafieldDefinitions?.edges?.length > 0) {
      messages.push(`Métafield variant (Nombre de numéros) : Déjà configuré`);
    } else {
      const createVariantMetafield = await admin.graphql(
        `#graphql
          mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id, name }
              userErrors { field, message }
            }
          }
        `,
        {
          variables: {
            definition: {
              name: "Nombre de numéros",
              namespace: "custom",
              key: "issue_count",
              description:
                "Nombre de numéros de magazine à accorder lors de l'achat de ce variant",
              type: "number_integer",
              ownerType: "PRODUCTVARIANT",
              pin: true,
              validations: [
                {
                  name: "min",
                  value: "1",
                },
              ],
            },
          },
        },
      );

      const jsonCreateVariantMF = await createVariantMetafield.json();
      const variantMFErrors =
        jsonCreateVariantMF.data?.metafieldDefinitionCreate?.userErrors;

      if (variantMFErrors && variantMFErrors.length > 0) {
        return new Response(
          JSON.stringify({ success: false, errors: variantMFErrors }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      messages.push(`Métafield variant (Nombre de numéros) : Créé avec succès`);
    }

    // --- DÉFINITION 2 : DROIT AU NUMÉRO ---
    const TYPE_ENTITLEMENT = "issue_entitlement";

    // 2. Vérification Droit au numéro
    const checkEntitlement = await admin.graphql(
      `#graphql
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) { id, type }
        }
      `,
      { variables: { type: TYPE_ENTITLEMENT } },
    );
    const jsonCheckEnt = await checkEntitlement.json();

    if (jsonCheckEnt.data?.metaobjectDefinitionByType) {
      messages.push(`Droit au numéro : Déjà configuré`);
    } else {
      // Création Droit au numéro
      const createEntitlement = await admin.graphql(
        `#graphql
          mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
            metaobjectDefinitionCreate(definition: $definition) {
              metaobjectDefinition { id }
              userErrors { field, message }
            }
          }
        `,
        {
          variables: {
            definition: {
              name: "Droit au numéro",
              type: TYPE_ENTITLEMENT,
              fieldDefinitions: [
                {
                  name: "Client",
                  key: "customer",
                  type: "customer_reference",
                },
                {
                  name: "Numéro de magazine",
                  key: "magazine_issue",
                  type: "metaobject_reference",
                  // CORRECTION : On utilise l'ID réel (gid://shopify/...) au lieu du type string
                  validations: [
                    {
                      name: "metaobject_definition_id",
                      value: magazineDefinitionId,
                    },
                  ],
                },
                {
                  name: "Commande source",
                  key: "source_order",
                  type: "order_reference",
                },
                {
                  name: "Statut",
                  key: "status",
                  type: "single_line_text_field",
                  validations: [
                    {
                      name: "choices",
                      value: JSON.stringify(["Actif", "Utilisé", "Expiré"]),
                    },
                  ],
                },
              ],
            },
          },
        },
      );
      const jsonCreateEnt = await createEntitlement.json();
      const errors = jsonCreateEnt.data?.metaobjectDefinitionCreate?.userErrors;

      if (errors && errors.length > 0) {
        return new Response(JSON.stringify({ success: false, errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      messages.push(`Droit au numéro : Créé avec succès`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: messages.join(" | "),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Une erreur inattendue est survenue:", error);
    return new Response(
      JSON.stringify({
        success: false,
        errors: [{ message: (error as Error).message }],
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};

export default function SetupPage() {
  const actionData = useActionData() as
    | {
        success: boolean;
        message?: string;
        errors?: Array<{ field?: string; message: string }>;
      }
    | undefined;
  return (
    <s-page heading="Configuration de l'application">
      <s-section heading="Configuration des définitions de méta object">
        <s-paragraph>
          Cette fonction va créer les définitions de méta fields nécessaire au
          bon fonctionnement de l&apos;application. Si une définition existe
          déjà, elle ne la créera pas une deuxième fois.
        </s-paragraph>
        <s-paragraph>À faire uniquement une fois.</s-paragraph>
        <Form method="post">
          <s-button type="submit">
            Créer les définitions de méta object
          </s-button>
        </Form>
        {actionData && (
          <div style={{ marginTop: "20px" }}>
            {actionData.success ? (
              <s-paragraph tone="success">{actionData.message}</s-paragraph>
            ) : (
              <s-paragraph tone="critical">
                Erreur: {actionData.errors?.map((e) => e.message).join(", ")}
              </s-paragraph>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}
