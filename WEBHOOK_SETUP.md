# Configuration du Webhook orders/paid

## ⚠️ Important

Le webhook `orders/paid` contient des données clients protégées et nécessite une approbation de Shopify. En mode développement, vous devez l'enregistrer **manuellement**.

## 🔧 Configuration en Mode Développement

### Étape 1: Démarrer votre app

```bash
pnpm run dev
```

### Étape 2: Noter l'URL du tunnel

Dans la console, après avoir lancé `pnpm run dev`, cherchez la ligne **"Preview URL"**:

```
Preview URL: https://abc123-xyz.ngrok.io
```

C'est cette URL que vous devez utiliser pour le webhook.

L'URL complète du webhook sera: `https://abc123-xyz.ngrok.io/webhooks/orders/paid`

### Étape 3: Créer le webhook dans Shopify Admin

1. Aller dans **Settings → Notifications**
2. Scroller jusqu'à **Webhooks**
3. Cliquer **Create webhook**
4. Configurer:
   - **Event**: `Order payment`
   - **Format**: `JSON`
   - **URL**: `https://abc123-xyz.ngrok.io/webhooks/orders/paid`
   - **API version**: `2026-01` (latest)
5. Cliquer **Save**

**Note importante**: L'URL ngrok change à chaque redémarrage de `pnpm run dev`. Vous devrez mettre à jour le webhook avec la nouvelle URL à chaque fois.

## 🔄 Comment ça fonctionne

Le webhook `orders/paid` se déclenche automatiquement quand une commande est payée. Le code:

1. Vérifie si le produit a le tag "magazine"
2. Lit le nombre de numéros depuis le metafield du variant
3. Trouve les N prochains numéros de magazine associés au produit
4. Crée automatiquement les droits pour le client

## 🧪 Tester le Webhook

### Vérifier que le webhook est enregistré

**Via Shopify Admin:**

- Settings → Notifications → Webhooks
- Vous devriez voir `Order payment` avec votre URL

**Via GraphQL:**

```graphql
{
  webhookSubscriptions(first: 10, topics: ORDERS_PAID) {
    edges {
      node {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
}
```

### Déclencher un test

1. **Créer une commande de test**
   - Orders → Create order
   - Ajouter un produit avec tag "magazine"
   - **Mark as paid** (important!)

2. **Vérifier les logs dans votre terminal VS Code**

   Dans le terminal où vous avez exécuté `pnpm run dev`, vous devriez voir les logs **immédiatement après avoir marqué la commande comme payée**:

   ```
   Received orders/paid webhook for your-shop.myshopify.com
   Traitement de la commande payée XXX
   Produit YYY est un abonnement magazine
   Variant ZZZ demande 3 numéros
   Trouvé 3 numéros éligibles (demandé: 3)
   Droit créé avec succès pour numéro ...
   Traitement terminé: 3 droits créés
   ```

   **Si vous ne voyez rien:**
   - Le webhook n'a probablement pas été appelé par Shopify
   - Vérifiez l'étape suivante pour diagnostiquer le problème

3. **Vérifier les résultats**
   - Content → Metaobjects → Droit au numéro
   - Les nouveaux droits devraient être créés

## 🔍 Troubleshooting

### Le webhook ne se déclenche pas (pas de logs dans le terminal)

Si vous ne voyez aucun log dans votre terminal VS Code après avoir créé une commande payée:

1. **Vérifier que le webhook est enregistré**
   - Settings → Notifications → Webhooks
   - Vous devriez voir un webhook "Order payment"

2. **Vérifier si Shopify a essayé d'appeler le webhook**
   - Settings → Notifications → Webhooks
   - Cliquer sur votre webhook "Order payment"
   - Regarder la section "Recent deliveries" en bas
   - Vous devriez voir des tentatives avec:
     - ✅ Checkmark vert = succès (200 OK)
     - ❌ X rouge = échec
   - Cliquer sur une tentative pour voir les détails (request, response, erreur)

3. **Si aucune tentative n'apparaît:**
   - Le webhook n'a pas été déclenché par Shopify
   - Vérifiez que vous avez bien cliqué "Mark as paid" sur la commande
   - Vérifiez que le webhook pointe vers "Order payment" et non "Order creation"

4. **Si tentative avec erreur (X rouge):**
   - Vérifier l'URL du webhook (doit être le Preview URL de pnpm run dev)
   - L'URL ngrok change à chaque redémarrage - mettre à jour le webhook
   - Vérifier que pnpm run dev est toujours en cours d'exécution

5. **Si tentative réussie (✓ vert) mais pas de logs:**
   - Le webhook a bien été appelé mais les logs ne s'affichent pas dans votre terminal
   - Vérifiez les résultats directement: Content → Metaobjects → Droit au numéro

### Erreur 403 ou 401

- Vérifier que votre app a les bons scopes
- Vérifier que le webhook est bien configuré

### Aucun droit créé

- Vérifier les logs du webhook pour voir l'erreur
- Vérifier que le produit a le tag "magazine"
- Vérifier que le variant a le metafield `issue_count`
- Vérifier qu'il existe des numéros avec date future

## 📚 Références

- [Shopify Webhooks Documentation](https://shopify.dev/docs/apps/webhooks)
- [Protected Customer Data](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [Webhook Topics](https://shopify.dev/docs/api/admin-rest/2026-01/resources/webhook#event-topics)
