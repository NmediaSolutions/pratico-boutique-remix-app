import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="Application de gestion Pratico">
      <s-section>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 1rem" }}>
          Bienvenue dans l&apos;application de gestion Pratico
        </h2>
        <s-paragraph>
          Cette application gère la création des Métafield, la création des
          droits aux numéros automatisée, l&apos;exportation de liste
          d&apos;exportation, le renouvellement des commandes, ainsi ainsi que
          le suivi des alertes.
        </s-paragraph>
      </s-section>

      <s-section>
        <h3
          style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}
        >
          Pour générer un fichier de liste d&apos;expédition .CSV
        </h3>
        <s-button variant="primary" href="/app/shipping-list">
          Générateur de listes d&apos;exportation
        </s-button>
      </s-section>

      <s-section>
        <h3
          style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}
        >
          Pour renouveler un abonnement
        </h3>
        <s-button variant="primary" href="/app/renewal-order">
          Renouveler une commande
        </s-button>
      </s-section>

      <s-section>
        <h3
          style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem" }}
        >
          Pour vérifier les alertes des numéros de magazine
        </h3>
        <s-button variant="primary" href="/app/alerts">
          Alertes des numéros de magazine
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
