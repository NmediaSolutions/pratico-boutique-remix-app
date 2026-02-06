import {
  extension,
  AdminBlock,
  BlockStack,
  Text,
  InlineStack,
  Badge,
  Box,
  Divider,
  Link,
  Heading,
} from "@shopify/ui-extensions/admin";

interface MetaobjectField {
  key: string;
  value?: string;
  reference?: {
    id?: string;
    displayName?: string;
  };
}

interface MetaobjectNode {
  id: string;
  fields: MetaobjectField[];
}

interface MetaobjectsResponse {
  data?: {
    metaobjects?: {
      edges: Array<{
        node: MetaobjectNode;
      }>;
    };
  };
}

interface IssueEntitlementItem {
  id: string;
  customer: string;
  magazine: string;
  status: string;
}

export default extension("admin.order-details.block.render", (root, api) => {
  const { data } = api;

  root.appendChild(
    root.createComponent(AdminBlock, { title: "Pratico App" }, [
      root.createComponent(BlockStack, { gap: "base" }, [
        root.createComponent(Text, {}, "Chargement..."),
      ]),
    ]),
  );

  const orderId = data.selected[0]?.id;
  if (!orderId) {
    root.replaceChildren(
      root.createComponent(AdminBlock, { title: "Pratico App" }, [
        root.createComponent(
          Text,
          {},
          "Aucun droit généré pour cette commande",
        ),
      ]),
    );
    return;
  }

  fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({
      query: `query($type:String!,$first:Int!){metaobjects(type:$type,first:$first){edges{node{id,fields{key,value,reference{...on Customer{displayName}...on Metaobject{displayName}...on Order{id}}}}}}}`,
      variables: { type: "issue_entitlement", first: 50 },
    }),
  })
    .then((r) => r.json())
    .then((result: MetaobjectsResponse) => {
      const allMetaobjects = result.data?.metaobjects?.edges || [];

      const items: IssueEntitlementItem[] = allMetaobjects
        .map(({ node }) => {
          const fields = node.fields;
          const order = fields.find((f) => f.key === "source_order");
          const orderRef = order?.reference?.id || order?.value;

          if (orderRef !== orderId) return null;

          const customerField = fields.find((f) => f.key === "customer");
          const customerName =
            customerField?.reference?.displayName ||
            customerField?.value?.split("/").pop() ||
            "N/A";

          return {
            id: node.id,
            customer: customerName,
            magazine:
              fields.find((f) => f.key === "magazine_issue")?.reference
                ?.displayName || "N/A",
            status: fields.find((f) => f.key === "status")?.value || "Actif",
          };
        })
        .filter((item): item is IssueEntitlementItem => item !== null);

      const getTone = (s: string): "success" | "info" | "warning" => {
        if (s === "Actif") return "success";
        if (s === "Utilisé") return "info";
        return "warning";
      };

      if (items.length === 0) {
        root.replaceChildren(
          root.createComponent(AdminBlock, { title: "Pratico App" }, [
            root.createComponent(
              Text,
              {},
              "Aucun droit généré pour cette commande",
            ),
          ]),
        );
      } else {
        const rows = items.map((e) => {
          // Extract the numeric ID from the GID (e.g., "gid://shopify/Metaobject/123456789" -> "123456789")
          const numericId = e.id.split("/").pop() || "";
          // Create a shortened display ID (show last 8 characters)
          const displayId =
            numericId.length > 8 ? "..." + numericId.slice(-8) : numericId;
          // Construct the URL to the metaobject
          const metaobjectUrl = `shopify://admin/content/entries/issue_entitlement/${numericId}`;

          return root.createComponent(InlineStack, { gap: "base" }, [
            root.createComponent(Box, { minInlineSize: "25%" }, [
              root.createComponent(Text, {}, e.customer),
            ]),
            root.createComponent(Box, { minInlineSize: "35%" }, [
              root.createComponent(Text, {}, e.magazine),
            ]),
            root.createComponent(Box, { minInlineSize: "15%" }, [
              root.createComponent(
                Badge,
                { tone: getTone(e.status) },
                e.status,
              ),
            ]),
            root.createComponent(Box, { minInlineSize: "15%" }, [
              root.createComponent(Link, { to: metaobjectUrl }, displayId),
            ]),
          ]);
        });

        root.replaceChildren(
          root.createComponent(AdminBlock, { title: "Pratico App" }, [
            root.createComponent(BlockStack, { gap: "base" }, [
              root.createComponent(Heading, { size: 3 }, "Droits aux numéros"),
              root.createComponent(Divider),
              root.createComponent(InlineStack, { gap: "base" }, [
                root.createComponent(Box, { minInlineSize: "25%" }, [
                  root.createComponent(Heading, { size: 4 }, "Client"),
                ]),
                root.createComponent(Box, { minInlineSize: "35%" }, [
                  root.createComponent(Heading, { size: 4 }, "Numéro"),
                ]),
                root.createComponent(Box, { minInlineSize: "15%" }, [
                  root.createComponent(Heading, { size: 4 }, "Statut"),
                ]),
                root.createComponent(Box, { minInlineSize: "15%" }, [
                  root.createComponent(Heading, { size: 4 }, "ID"),
                ]),
              ]),
              ...rows,
            ]),
          ]),
        );
      }
    })
    .catch(() => {
      root.replaceChildren(
        root.createComponent(AdminBlock, { title: "Pratico App" }, [
          root.createComponent(Text, {}, "Erreur de chargement"),
        ]),
      );
    });
});
