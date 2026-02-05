import { Form, useActionData, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Field definition type for metaobject fields
interface FieldDefinition {
  name: string;
  key: string;
  type: string;
  description?: string;
  validations?: Array<{ name: string; value: string }>;
}

// Complete field specifications for magazine_issue
const MAGAZINE_ISSUE_FIELDS: FieldDefinition[] = [
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
];

// Complete field specifications for issue_entitlement
const ISSUE_ENTITLEMENT_FIELDS: FieldDefinition[] = [
  {
    name: "Client",
    key: "customer",
    type: "customer_reference",
  },
  {
    name: "Numéro de magazine",
    key: "magazine_issue",
    type: "metaobject_reference",
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
];

// Complete field specifications for subscription
const SUBSCRIPTION_FIELDS: FieldDefinition[] = [
  {
    name: "ID d'abonnement",
    key: "subscription_id",
    type: "single_line_text_field",
    description: "Identifiant unique de l'abonnement",
  },
  {
    name: "Statut de l'abonnement",
    key: "subscription_status",
    type: "single_line_text_field",
    description: "Statut actuel de l'abonnement",
    validations: [
      {
        name: "choices",
        value: JSON.stringify(["Abonné", "Cancellé"]),
      },
    ],
  },
  {
    name: "Droits aux numéros",
    key: "issue_entitlements",
    type: "list.metaobject_reference",
    description: "Liste des droits aux numéros associés à cet abonnement",
  },
  {
    name: "Produit",
    key: "products",
    type: "product_reference",
    description: "Produit associé à l'abonnement",
  },
  {
    name: "Commande",
    key: "order",
    type: "order_reference",
    description:
      "Dernière commande associée à l'abonnement (pour compatibilité)",
  },
  {
    name: "Commandes",
    key: "orders",
    type: "list.order_reference",
    description:
      "Liste de toutes les commandes associées à cet abonnement (initiale + renouvellements)",
  },
  {
    name: "Date de début",
    key: "subscription_start_date",
    type: "date",
    description: "Date de début de l'abonnement",
  },
  {
    name: "Nombre de renouvellements",
    key: "renewals_amount",
    type: "number_integer",
    description: "Compteur de renouvellements",
    validations: [
      {
        name: "min",
        value: "0",
      },
    ],
  },
];

// Complete field specifications for magazine_issue_alert
const MAGAZINE_ISSUE_ALERT_FIELDS: FieldDefinition[] = [
  {
    name: "Type d'alerte",
    key: "alert_type",
    type: "single_line_text_field",
    description: "Type d'alerte généré",
    validations: [
      {
        name: "choices",
        value: JSON.stringify(["no_issues", "insufficient_issues"]),
      },
    ],
  },
  {
    name: "Type de commande",
    key: "order_type",
    type: "single_line_text_field",
    description: "Type de commande qui a déclenché l'alerte",
    validations: [
      {
        name: "choices",
        value: JSON.stringify(["new_order", "renewal"]),
      },
    ],
  },
  {
    name: "Commande",
    key: "order",
    type: "order_reference",
    description: "Commande qui a déclenché l'alerte",
  },
  {
    name: "Client",
    key: "customer",
    type: "customer_reference",
    description: "Client concerné par l'alerte",
  },
  {
    name: "Produit",
    key: "product",
    type: "product_reference",
    description: "Produit magazine concerné",
  },
  {
    name: "Abonnement",
    key: "subscription",
    type: "metaobject_reference",
    description: "Abonnement concerné (si renouvellement)",
  },
  {
    name: "Numéros requis",
    key: "required_issues",
    type: "number_integer",
    description: "Nombre de numéros requis",
    validations: [
      {
        name: "min",
        value: "0",
      },
    ],
  },
  {
    name: "Numéros disponibles",
    key: "available_issues",
    type: "number_integer",
    description: "Nombre de numéros disponibles",
    validations: [
      {
        name: "min",
        value: "0",
      },
    ],
  },
  {
    name: "Date de l'alerte",
    key: "alert_date",
    type: "date_time",
    description: "Date et heure de génération de l'alerte",
  },
  {
    name: "Statut",
    key: "status",
    type: "single_line_text_field",
    description: "Statut de l'alerte",
    validations: [
      {
        name: "choices",
        value: JSON.stringify(["unresolved", "resolved", "ignored"]),
      },
    ],
  },
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const messages: string[] = [];

  // --- DÉFINITION 1 : NUMÉRO DE MAGAZINE ---
  const TYPE_MAGAZINE = "magazine_issue";
  let magazineDefinitionId = "";

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

      // Get existing field keys
      const existingFields =
        jsonCheckMag.data.metaobjectDefinitionByType.fieldDefinitions;
      const existingFieldKeys = new Set(
        existingFields.map((field: { key: string }) => field.key),
      );

      // Find missing fields
      const missingFields = MAGAZINE_ISSUE_FIELDS.filter(
        (field) => !existingFieldKeys.has(field.key),
      );

      // Check if displayNameKey needs updating
      const currentDisplayNameKey =
        jsonCheckMag.data.metaobjectDefinitionByType.displayNameKey;
      const needsDisplayNameUpdate = currentDisplayNameKey !== "title";

      if (missingFields.length > 0 || needsDisplayNameUpdate) {
        const updates = [];

        // Add title field first if it's missing (needed for displayNameKey)
        const titleFieldMissing = missingFields.find(
          (field) => field.key === "title",
        );
        if (titleFieldMissing) {
          const addTitleField = await admin.graphql(
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
                      name: titleFieldMissing.name,
                      key: titleFieldMissing.key,
                      type: titleFieldMissing.type,
                      ...(titleFieldMissing.description && {
                        description: titleFieldMissing.description,
                      }),
                      ...(titleFieldMissing.validations && {
                        validations: titleFieldMissing.validations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddTitle = await addTitleField.json();
          const titleErrors =
            jsonAddTitle.data?.metaobjectDefinitionUpdate?.userErrors;

          if (titleErrors && titleErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: titleErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${titleFieldMissing.name}" ajouté`);
        }

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

        // Add remaining missing fields
        for (const field of missingFields) {
          if (field.key === "title") continue; // Already added

          const addField = await admin.graphql(
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
                      name: field.name,
                      key: field.key,
                      type: field.type,
                      ...(field.description && {
                        description: field.description,
                      }),
                      ...(field.validations && {
                        validations: field.validations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddField = await addField.json();
          const fieldErrors =
            jsonAddField.data?.metaobjectDefinitionUpdate?.userErrors;

          if (fieldErrors && fieldErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: fieldErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${field.name}" ajouté`);
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
              fieldDefinitions: MAGAZINE_ISSUE_FIELDS.map((field) => ({
                name: field.name,
                key: field.key,
                type: field.type,
                ...(field.description && { description: field.description }),
                ...(field.validations && { validations: field.validations }),
              })),
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
      magazineDefinitionId =
        jsonCreateMag.data.metaobjectDefinitionCreate.metaobjectDefinition.id;
    }

    // --- MÉTAFIELD PRODUCT : NUMÉROS DE MAGAZINE ASSOCIÉS ---
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

    // --- MÉTAFIELD ORDER : ABONNEMENTS ---
    const checkOrderMetafield = await admin.graphql(
      `#graphql
        query {
          metafieldDefinitions(first: 1, ownerType: ORDER, key: "subscriptions", namespace: "custom") {
            edges {
              node { id }
            }
          }
        }
      `,
    );

    const jsonCheckOrderMF = await checkOrderMetafield.json();

    if (jsonCheckOrderMF.data?.metafieldDefinitions?.edges?.length > 0) {
      messages.push(`Métafield order (Abonnements) : Déjà configuré`);
    } else {
      // We need to create the subscription metaobject definition first to get its ID
      // This will be available after the subscription definition is created below
      // We'll add this metafield after subscription definition is created
      messages.push(
        `Métafield order (Abonnements) : Sera créé après la définition subscription`,
      );
    }

    // --- DÉFINITION 2 : ABONNEMENT (SUBSCRIPTION) ---
    const TYPE_SUBSCRIPTION = "subscription";
    let subscriptionDefinitionId = "";

    // 2. Vérification Abonnement
    const checkSubscription = await admin.graphql(
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
      { variables: { type: TYPE_SUBSCRIPTION } },
    );
    const jsonCheckSub = await checkSubscription.json();

    if (jsonCheckSub.data?.metaobjectDefinitionByType) {
      subscriptionDefinitionId =
        jsonCheckSub.data.metaobjectDefinitionByType.id;

      // Get existing field keys
      const existingFields =
        jsonCheckSub.data.metaobjectDefinitionByType.fieldDefinitions;
      const existingFieldKeys = new Set(
        existingFields.map((field: { key: string }) => field.key),
      );

      // Find missing fields
      const missingFields = SUBSCRIPTION_FIELDS.filter(
        (field) => !existingFieldKeys.has(field.key),
      );

      // Check if displayNameKey needs updating
      const currentDisplayNameKey =
        jsonCheckSub.data.metaobjectDefinitionByType.displayNameKey;
      const needsDisplayNameUpdate =
        currentDisplayNameKey !== "subscription_id";

      if (missingFields.length > 0 || needsDisplayNameUpdate) {
        const updates = [];

        // Add subscription_id field first if it's missing (needed for displayNameKey)
        const subscriptionIdFieldMissing = missingFields.find(
          (field) => field.key === "subscription_id",
        );
        if (subscriptionIdFieldMissing) {
          const addSubscriptionIdField = await admin.graphql(
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
                id: subscriptionDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: subscriptionIdFieldMissing.name,
                      key: subscriptionIdFieldMissing.key,
                      type: subscriptionIdFieldMissing.type,
                      ...(subscriptionIdFieldMissing.description && {
                        description: subscriptionIdFieldMissing.description,
                      }),
                      ...(subscriptionIdFieldMissing.validations && {
                        validations: subscriptionIdFieldMissing.validations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddSubscriptionId = await addSubscriptionIdField.json();
          const subscriptionIdErrors =
            jsonAddSubscriptionId.data?.metaobjectDefinitionUpdate?.userErrors;

          if (subscriptionIdErrors && subscriptionIdErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: subscriptionIdErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${subscriptionIdFieldMissing.name}" ajouté`);
        }

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
                id: subscriptionDefinitionId,
                definition: {
                  displayNameKey: "subscription_id",
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
          updates.push('DisplayNameKey configuré sur "subscription_id"');
        }

        // Add remaining missing fields
        for (const field of missingFields) {
          if (field.key === "subscription_id") continue; // Already added
          if (field.key === "issue_entitlements") continue; // Skip - will be added later with proper validation

          const addField = await admin.graphql(
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
                id: subscriptionDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: field.name,
                      key: field.key,
                      type: field.type,
                      ...(field.description && {
                        description: field.description,
                      }),
                      ...(field.validations && {
                        validations: field.validations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddField = await addField.json();
          const fieldErrors =
            jsonAddField.data?.metaobjectDefinitionUpdate?.userErrors;

          if (fieldErrors && fieldErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: fieldErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${field.name}" ajouté`);
        }

        messages.push(`Abonnement : ${updates.join(", ")}`);
      } else {
        messages.push(`Abonnement : Déjà configuré avec tous les champs`);
      }
    } else {
      // Création Abonnement
      const createSubscription = await admin.graphql(
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
              name: "Abonnement",
              type: TYPE_SUBSCRIPTION,
              displayNameKey: "subscription_id",
              fieldDefinitions: SUBSCRIPTION_FIELDS.filter(
                // Completely exclude issue_entitlements from initial creation
                (field) => field.key !== "issue_entitlements",
              ).map((field) => ({
                name: field.name,
                key: field.key,
                type: field.type,
                ...(field.description && { description: field.description }),
                ...(field.validations && { validations: field.validations }),
              })),
            },
          },
        },
      );
      const jsonCreateSub = await createSubscription.json();
      const errors = jsonCreateSub.data?.metaobjectDefinitionCreate?.userErrors;

      if (errors && errors.length > 0) {
        return new Response(JSON.stringify({ success: false, errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      messages.push(`Abonnement : Créé avec succès`);
      subscriptionDefinitionId =
        jsonCreateSub.data.metaobjectDefinitionCreate.metaobjectDefinition.id;
    }

    // --- DÉFINITION 3 : DROIT AU NUMÉRO (ISSUE_ENTITLEMENT) ---
    const TYPE_ENTITLEMENT = "issue_entitlement";
    let entitlementDefinitionId = "";

    // 3. Vérification Droit au numéro
    const checkEntitlement = await admin.graphql(
      `#graphql
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            type
            fieldDefinitions {
              key
            }
          }
        }
      `,
      { variables: { type: TYPE_ENTITLEMENT } },
    );
    const jsonCheckEnt = await checkEntitlement.json();

    if (jsonCheckEnt.data?.metaobjectDefinitionByType) {
      entitlementDefinitionId = jsonCheckEnt.data.metaobjectDefinitionByType.id;

      // Get existing field keys
      const existingFields =
        jsonCheckEnt.data.metaobjectDefinitionByType.fieldDefinitions;
      const existingFieldKeys = new Set(
        existingFields.map((field: { key: string }) => field.key),
      );

      // Find missing fields
      const missingFields = ISSUE_ENTITLEMENT_FIELDS.filter(
        (field) => !existingFieldKeys.has(field.key),
      );

      if (missingFields.length > 0) {
        const updates = [];

        // Add each missing field
        for (const field of missingFields) {
          // Special handling for magazine_issue field which needs the magazineDefinitionId
          const fieldValidations =
            field.key === "magazine_issue"
              ? [
                  {
                    name: "metaobject_definition_id",
                    value: magazineDefinitionId,
                  },
                ]
              : field.validations;

          const addField = await admin.graphql(
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
                id: entitlementDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: field.name,
                      key: field.key,
                      type: field.type,
                      ...(field.description && {
                        description: field.description,
                      }),
                      ...(fieldValidations && {
                        validations: fieldValidations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddField = await addField.json();
          const fieldErrors =
            jsonAddField.data?.metaobjectDefinitionUpdate?.userErrors;

          if (fieldErrors && fieldErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: fieldErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${field.name}" ajouté`);
        }

        messages.push(`Droit au numéro : ${updates.join(", ")}`);
      } else {
        messages.push(`Droit au numéro : Déjà configuré avec tous les champs`);
      }
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
              fieldDefinitions: ISSUE_ENTITLEMENT_FIELDS.map((field) => {
                // Special handling for magazine_issue field
                const fieldValidations =
                  field.key === "magazine_issue"
                    ? [
                        {
                          name: "metaobject_definition_id",
                          value: magazineDefinitionId,
                        },
                      ]
                    : field.validations;

                return {
                  name: field.name,
                  key: field.key,
                  type: field.type,
                  ...(field.description && { description: field.description }),
                  ...(fieldValidations && { validations: fieldValidations }),
                };
              }),
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
      entitlementDefinitionId =
        jsonCreateEnt.data.metaobjectDefinitionCreate.metaobjectDefinition.id;
    }

    // --- BIDIRECTIONAL LINK: ADD SUBSCRIPTION FIELD TO ISSUE_ENTITLEMENT ---
    // Check if issue_entitlement already has a subscription field
    const recheckEntitlement = await admin.graphql(
      `#graphql
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            fieldDefinitions {
              key
            }
          }
        }
      `,
      { variables: { type: TYPE_ENTITLEMENT } },
    );
    const jsonRecheckEnt = await recheckEntitlement.json();
    const currentEntitlementFields =
      jsonRecheckEnt.data?.metaobjectDefinitionByType?.fieldDefinitions || [];
    const hasSubscriptionField = currentEntitlementFields.some(
      (field: { key: string }) => field.key === "subscription",
    );

    if (!hasSubscriptionField) {
      const addSubscriptionField = await admin.graphql(
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
            id: entitlementDefinitionId,
            definition: {
              fieldDefinitions: {
                create: {
                  name: "Abonnement",
                  key: "subscription",
                  type: "metaobject_reference",
                  description: "Abonnement associé à ce droit au numéro",
                  validations: [
                    {
                      name: "metaobject_definition_id",
                      value: subscriptionDefinitionId,
                    },
                  ],
                },
              },
            },
          },
        },
      );
      const jsonAddSubscriptionField = await addSubscriptionField.json();
      const subscriptionFieldErrors =
        jsonAddSubscriptionField.data?.metaobjectDefinitionUpdate?.userErrors;

      if (subscriptionFieldErrors && subscriptionFieldErrors.length > 0) {
        return new Response(
          JSON.stringify({ success: false, errors: subscriptionFieldErrors }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      messages.push(
        `Droit au numéro : Champ "Abonnement" (lien bidirectionnel) ajouté`,
      );
    } else {
      messages.push(`Droit au numéro : Champ "Abonnement" déjà présent`);
    }

    // --- CREATE ORDER METAFIELD NOW THAT WE HAVE SUBSCRIPTION DEFINITION ID ---
    if (subscriptionDefinitionId) {
      const recheckOrderMetafield = await admin.graphql(
        `#graphql
          query {
            metafieldDefinitions(first: 1, ownerType: ORDER, key: "subscriptions", namespace: "custom") {
              edges {
                node { id }
              }
            }
          }
        `,
      );

      const jsonRecheckOrderMF = await recheckOrderMetafield.json();

      if (jsonRecheckOrderMF.data?.metafieldDefinitions?.edges?.length === 0) {
        const createOrderMetafield = await admin.graphql(
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
                name: "Abonnements",
                namespace: "custom",
                key: "subscriptions",
                description: "Liste des abonnements associés à cette commande",
                type: "list.metaobject_reference",
                ownerType: "ORDER",
                pin: true,
                validations: [
                  {
                    name: "metaobject_definition_id",
                    value: subscriptionDefinitionId,
                  },
                ],
              },
            },
          },
        );

        const jsonCreateOrderMF = await createOrderMetafield.json();
        const orderMFErrors =
          jsonCreateOrderMF.data?.metafieldDefinitionCreate?.userErrors;

        if (orderMFErrors && orderMFErrors.length > 0) {
          return new Response(
            JSON.stringify({ success: false, errors: orderMFErrors }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        messages.push(`Métafield order (Abonnement) : Créé avec succès`);
      } else {
        messages.push(`Métafield order (Abonnement) : Déjà configuré`);
      }
    }

    // --- DÉFINITION 4 : ALERTE NUMÉRO DE MAGAZINE (MAGAZINE_ISSUE_ALERT) ---
    const TYPE_ALERT = "magazine_issue_alert";

    // 4. Vérification Alerte numéro de magazine
    const checkAlert = await admin.graphql(
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
      { variables: { type: TYPE_ALERT } },
    );
    const jsonCheckAlert = await checkAlert.json();

    if (jsonCheckAlert.data?.metaobjectDefinitionByType) {
      const alertDefinitionId =
        jsonCheckAlert.data.metaobjectDefinitionByType.id;

      // Get existing field keys
      const existingFields =
        jsonCheckAlert.data.metaobjectDefinitionByType.fieldDefinitions;
      const existingFieldKeys = new Set(
        existingFields.map((field: { key: string }) => field.key),
      );

      // Find missing fields
      const missingFields = MAGAZINE_ISSUE_ALERT_FIELDS.filter(
        (field) => !existingFieldKeys.has(field.key),
      );

      // Check if displayNameKey needs updating
      const currentDisplayNameKey =
        jsonCheckAlert.data.metaobjectDefinitionByType.displayNameKey;
      const needsDisplayNameUpdate = currentDisplayNameKey !== "alert_date";

      if (missingFields.length > 0 || needsDisplayNameUpdate) {
        const updates = [];

        // Add alert_date field first if it's missing (needed for displayNameKey)
        const alertDateFieldMissing = missingFields.find(
          (field) => field.key === "alert_date",
        );
        if (alertDateFieldMissing) {
          const addAlertDateField = await admin.graphql(
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
                id: alertDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: alertDateFieldMissing.name,
                      key: alertDateFieldMissing.key,
                      type: alertDateFieldMissing.type,
                      ...(alertDateFieldMissing.description && {
                        description: alertDateFieldMissing.description,
                      }),
                      ...(alertDateFieldMissing.validations && {
                        validations: alertDateFieldMissing.validations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddAlertDate = await addAlertDateField.json();
          const alertDateErrors =
            jsonAddAlertDate.data?.metaobjectDefinitionUpdate?.userErrors;

          if (alertDateErrors && alertDateErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: alertDateErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${alertDateFieldMissing.name}" ajouté`);
        }

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
                id: alertDefinitionId,
                definition: {
                  displayNameKey: "alert_date",
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
          updates.push('DisplayNameKey configuré sur "alert_date"');
        }

        // Add remaining missing fields
        for (const field of missingFields) {
          if (field.key === "alert_date") continue; // Already added

          // Special handling for subscription field which needs subscriptionDefinitionId
          const fieldValidations =
            field.key === "subscription"
              ? [
                  {
                    name: "metaobject_definition_id",
                    value: subscriptionDefinitionId,
                  },
                ]
              : field.validations;

          const addField = await admin.graphql(
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
                id: alertDefinitionId,
                definition: {
                  fieldDefinitions: {
                    create: {
                      name: field.name,
                      key: field.key,
                      type: field.type,
                      ...(field.description && {
                        description: field.description,
                      }),
                      ...(fieldValidations && {
                        validations: fieldValidations,
                      }),
                    },
                  },
                },
              },
            },
          );
          const jsonAddField = await addField.json();
          const fieldErrors =
            jsonAddField.data?.metaobjectDefinitionUpdate?.userErrors;

          if (fieldErrors && fieldErrors.length > 0) {
            return new Response(
              JSON.stringify({ success: false, errors: fieldErrors }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          updates.push(`Champ "${field.name}" ajouté`);
        }

        messages.push(`Alerte numéro de magazine : ${updates.join(", ")}`);
      } else {
        messages.push(
          `Alerte numéro de magazine : Déjà configuré avec tous les champs`,
        );
      }
    } else {
      // Création Alerte numéro de magazine
      const createAlert = await admin.graphql(
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
              name: "Alerte numéro de magazine",
              type: TYPE_ALERT,
              displayNameKey: "alert_date",
              fieldDefinitions: MAGAZINE_ISSUE_ALERT_FIELDS.map((field) => {
                // Special handling for subscription field which needs subscriptionDefinitionId
                const fieldValidations =
                  field.key === "subscription"
                    ? [
                        {
                          name: "metaobject_definition_id",
                          value: subscriptionDefinitionId,
                        },
                      ]
                    : field.validations;

                return {
                  name: field.name,
                  key: field.key,
                  type: field.type,
                  ...(field.description && { description: field.description }),
                  ...(fieldValidations && { validations: fieldValidations }),
                };
              }),
            },
          },
        },
      );
      const jsonCreateAlert = await createAlert.json();
      const errors =
        jsonCreateAlert.data?.metaobjectDefinitionCreate?.userErrors;

      if (errors && errors.length > 0) {
        return new Response(JSON.stringify({ success: false, errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      messages.push(`Alerte numéro de magazine : Créé avec succès`);
    }

    // --- ADD ISSUE_ENTITLEMENTS FIELD WITH VALIDATION IF IT DOESN'T EXIST ---
    // Check if the issue_entitlements field needs to be added with proper validation
    if (entitlementDefinitionId && subscriptionDefinitionId) {
      const recheckSubscription = await admin.graphql(
        `#graphql
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            fieldDefinitions {
              key
              validations {
                name
                value
              }
            }
          }
        }
      `,
        { variables: { type: TYPE_SUBSCRIPTION } },
      );
      const jsonRecheckSub = await recheckSubscription.json();
      const subscriptionFields =
        jsonRecheckSub.data?.metaobjectDefinitionByType?.fieldDefinitions || [];
      const issueEntitlementsField = subscriptionFields.find(
        (field: { key: string }) => field.key === "issue_entitlements",
      );

      // Check if field exists and has proper validation
      const hasProperValidation =
        issueEntitlementsField &&
        issueEntitlementsField.validations &&
        issueEntitlementsField.validations.some(
          (v: { name: string; value: string }) =>
            v.name === "metaobject_definition_id" &&
            v.value === entitlementDefinitionId,
        );

      if (!issueEntitlementsField) {
        // Field doesn't exist at all, add it with proper validation
        const addIssueEntitlementsField = await admin.graphql(
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
              id: subscriptionDefinitionId,
              definition: {
                fieldDefinitions: {
                  create: {
                    name: "Droits aux numéros",
                    key: "issue_entitlements",
                    type: "list.metaobject_reference",
                    description:
                      "Liste des droits aux numéros associés à cet abonnement",
                    validations: [
                      {
                        name: "metaobject_definition_id",
                        value: entitlementDefinitionId,
                      },
                    ],
                  },
                },
              },
            },
          },
        );
        const jsonAddField = await addIssueEntitlementsField.json();
        const addErrors =
          jsonAddField.data?.metaobjectDefinitionUpdate?.userErrors;

        if (addErrors && addErrors.length > 0) {
          return new Response(
            JSON.stringify({ success: false, errors: addErrors }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        messages.push(
          `Abonnement : Champ "Droits aux numéros" ajouté avec validation`,
        );
      } else if (hasProperValidation) {
        messages.push(
          `Abonnement : Champ "Droits aux numéros" déjà configuré avec validation`,
        );
      } else {
        // Field exists but without proper validation - note this but don't fail
        messages.push(
          `Abonnement : Champ "Droits aux numéros" existe (validation manuelle requise si nécessaire)`,
        );
      }
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
