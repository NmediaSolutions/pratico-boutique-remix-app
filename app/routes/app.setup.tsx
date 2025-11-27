import { Form, useActionData, type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const METAOBJECT_TYPE = "magazine_issue";

  // Valide si le meta object est déjà présent
  try {
    const responseCheck = await admin.graphql(
      `#graphql
        query MetaobjectDefinitionByType($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            type
          }
        }
      `,
      { variables: { type: METAOBJECT_TYPE } },
    );

    const checkJson = await responseCheck.json();

    // Message qui dit qu'on a déjà le méta object
    if (checkJson.data?.metaobjectDefinitionByType) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Déjà configuré. Type: ${checkJson.data.metaobjectDefinitionByType.type}`,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Créer le meta object
    const responseCreate = await admin.graphql(
      `#graphql
        mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
          metaobjectDefinitionCreate(definition: $definition) {
            metaobjectDefinition { id, name }
            userErrors { field, message }
          }
        }
      `,
      {
        variables: {
          definition: {
            name: "Numéro de magazine",
            type: METAOBJECT_TYPE,
            // Retiré car pas possible avec une custom app
            // access: { admin: "MERCHANT_READ_WRITE" },
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
            ],
          },
        },
      },
    );

    const createJson = await responseCreate.json();
    const userErrors = createJson.data?.metaobjectDefinitionCreate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      return new Response(
        JSON.stringify({ success: false, errors: userErrors }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Configuration terminée avec succès !",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Une erreur inattendue est survenue:", error);
    return new Response(
      JSON.stringify({
        success: false,
        errors: [{ message: (error as Error).message }],
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

export default function SetupPage() {
  const actionData = useActionData() as
    | { success: boolean; message?: string; errors?: any[] }
    | undefined;

  return (
    <s-page heading="Configuration de l'application">
      <s-section heading="Configuration des définitions de méta object">
        <s-paragraph>
          Cette fonction va créer les définitions de méta fields nécessaire au
          bon fonctionnement de l'application. Si une définition existe déjà,
          elle ne la créera pas une deuxième fois.
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
