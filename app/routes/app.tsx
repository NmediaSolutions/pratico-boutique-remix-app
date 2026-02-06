import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Fetch unresolved alerts count
  let unresolvedCount = 0;
  try {
    const alertsResponse = await admin.graphql(
      `#graphql
        query getUnresolvedAlertsCount {
          metaobjects(type: "magazine_issue_alert", first: 250) {
            edges {
              node {
                id
                status: field(key: "status") {
                  value
                }
              }
            }
          }
        }
      `,
    );

    const alertsData = await alertsResponse.json();
    const alerts = alertsData.data?.metaobjects?.edges || [];
    unresolvedCount = alerts.filter(
      (edge: { node: { status?: { value: string } } }) =>
        edge.node.status?.value === "unresolved",
    ).length;
  } catch (error) {
    console.error("Error fetching alerts count:", error);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", unresolvedCount };
};

export default function App() {
  const { apiKey, unresolvedCount } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Accueil</s-link>
        <s-link href="/app/shipping-list">
          Générateur de liste d&apos;expédition
        </s-link>
        <s-link href="/app/renewal-order">Renouveler une commande</s-link>
        <s-link href="/app/alerts">
          {unresolvedCount > 0 && ` (${unresolvedCount}) `}
          Alertes des numéros de magazine
        </s-link>
        <s-link href="/app/setup">Setup</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
