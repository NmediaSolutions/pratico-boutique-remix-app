// API pour get les variants de produits
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return Response.json({ error: "productId is required" }, { status: 400 });
  }

  try {
    const variantsResponse = await admin.graphql(
      `#graphql
        query getProductVariants($id: ID!) {
          product(id: $id) {
            id
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  issueCount: metafield(namespace: "custom", key: "issue_count") {
                    value
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: productId,
        },
      },
    );

    const variantsData = await variantsResponse.json();
    const product = variantsData.data?.product;

    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 404 });
    }

    const variants = product.variants.edges.map(
      (edge: {
        node: {
          id: string;
          title: string;
          price: string;
          issueCount?: { value: string };
        };
      }) => ({
        id: edge.node.id,
        title: edge.node.title,
        price: edge.node.price,
        issueCount: edge.node.issueCount?.value || "0",
      }),
    );

    return Response.json({ variants });
  } catch (error) {
    console.error("Error fetching product variants:", error);
    return Response.json(
      { error: "Failed to fetch variants" },
      { status: 500 },
    );
  }
};
