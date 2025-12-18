import { extension } from "@shopify/ui-extensions/admin";

export default extension("admin.order-details.block.render", (root, api) => {
  const { data } = api;
  
  root.appendChild(
    root.createComponent("AdminBlock", { title: "Droits au numéro" }, [
      root.createComponent("BlockStack", { gap: "base" }, [
        root.createComponent("Text", {}, "Chargement...")
      ])
    ])
  );

  const orderId = data.selected[0]?.id;
  if (!orderId) {
    root.replaceChildren(
      root.createComponent("AdminBlock", { title: "Droits au numéro" }, [
        root.createComponent("Text", { tone: "subdued" }, "Aucun droit généré pour cette commande")
      ])
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
    .then((result) => {
      const allMetaobjects = result.data?.metaobjects?.edges || [];
      
      const items = allMetaobjects
        .map(({ node }) => {
          const fields = node.fields;
          const order = fields.find((f) => f.key === "source_order");
          const orderRef = order?.reference?.id || order?.value;
          
          if (orderRef !== orderId) return null;
          
          const customerField = fields.find((f) => f.key === "customer");
          const customerName = customerField?.reference?.displayName || customerField?.value?.split("/").pop() || "N/A";
          
          return {
            id: node.id,
            customer: customerName,
            magazine: fields.find((f) => f.key === "magazine_issue")?.reference?.displayName || "N/A",
            status: fields.find((f) => f.key === "status")?.value || "Actif",
          };
        })
        .filter(Boolean);

      const getTone = (s) => (s === "Actif" ? "success" : s === "Utilisé" ? "info" : "warning");

      if (items.length === 0) {
        root.replaceChildren(
          root.createComponent("AdminBlock", { title: "Droits au numéro" }, [
            root.createComponent("Text", { tone: "subdued" }, "Aucun droit généré pour cette commande")
          ])
        );
      } else {
        const rows = items.map((e) =>
          root.createComponent("InlineStack", { gap: "base" }, [
            root.createComponent("Box", { minInlineSize: "30%" }, [
              root.createComponent("Text", {}, e.customer)
            ]),
            root.createComponent("Box", { minInlineSize: "40%" }, [
              root.createComponent("Text", {}, e.magazine)
            ]),
            root.createComponent("Box", { minInlineSize: "20%" }, [
              root.createComponent("Badge", { tone: getTone(e.status) }, e.status)
            ]),
          ])
        );

        root.replaceChildren(
          root.createComponent("AdminBlock", { title: "Droits au numéro" }, [
            root.createComponent("BlockStack", { gap: "base" }, [
              root.createComponent("InlineStack", { gap: "base" }, [
                root.createComponent("Box", { minInlineSize: "30%" }, [
                  root.createComponent("Text", { fontWeight: "bold" }, "Client")
                ]),
                root.createComponent("Box", { minInlineSize: "40%" }, [
                  root.createComponent("Text", { fontWeight: "bold" }, "Numéro")
                ]),
                root.createComponent("Box", { minInlineSize: "20%" }, [
                  root.createComponent("Text", { fontWeight: "bold" }, "Statut")
                ]),
              ]),
              ...rows
            ])
          ])
        );
      }
    })
    .catch(() => {
      root.replaceChildren(
        root.createComponent("AdminBlock", { title: "Droits au numéro" }, [
          root.createComponent("Text", { tone: "critical" }, "Erreur de chargement")
        ])
      );
    });
});
