import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const shopResponse = await admin.graphql(`
    query GetBundleProducts {
      shop {
        metafield(namespace: "app", key: "products") {
          value
        }
      }
    }
  `);
  const shopResult = await shopResponse.json();
  const rawProductIds = shopResult.data?.shop?.metafield?.value || "[]";

  let productIds = [];

  try {
    productIds = JSON.parse(rawProductIds);
  } catch {
    productIds = [];
  }

  if (productIds.length === 0) {
    return { products: [] };
  }

  const productsResponse = await admin.graphql(
    `query GetProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            featuredImage {
              url
            }
          }
        }
      }
    `,
    { variables: { ids: productIds } },
  );
  const productsData = await productsResponse.json();

  return { products: productsData.data?.nodes || [] };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const rawProductIds = formData.get("productIds");

  let productIds = [];

  try {
    productIds = JSON.parse(rawProductIds || "[]");
  } catch {
    return Response.json(
      { ok: false, error: "Selected products could not be read." },
      { status: 400 },
    );
  }

  productIds = [...new Set(productIds)].filter(
    (productId) =>
      typeof productId === "string" &&
      productId.startsWith("gid://shopify/Product/"),
  );

  if (productIds.length === 0) {
    return Response.json(
      { ok: false, error: "Select at least one product first." },
      { status: 400 },
    );
  }

  const shopResponse = await admin.graphql(`#graphql
    query ShopId {
      shop {
        id
      }
    }
  `);
  const shopResult = await shopResponse.json();
  const shopId = shopResult.data?.shop?.id;

  if (!shopId) {
    return Response.json(
      { ok: false, error: "Shop ID could not be loaded." },
      { status: 500 },
    );
  }

  const metafieldsResponse = await admin.graphql(
    `mutation SetBundleProductsMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "app",
            key: "products",
            type: "list.product_reference",
            value: JSON.stringify(productIds),
          },
        ],
      },
    },
  );
  const metafieldsResult = await metafieldsResponse.json();
  const userErrors = metafieldsResult.data?.metafieldsSet?.userErrors || [];

  if (userErrors.length > 0 || metafieldsResult.errors?.length > 0) {
    return Response.json(
      {
        ok: false,
        error:
          userErrors[0]?.message ||
          metafieldsResult.errors?.[0]?.message ||
          "Products could not be saved.",
      },
      { status: 400 },
    );
  }

  return Response.json({ ok: true, productCount: productIds.length });
};

export default function Index() {
  const { products } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [selectedProducts, setSelectedProducts] = useState([]);
  const displayedProducts =
    selectedProducts.length > 0 ? selectedProducts : products;

  async function selectProducts() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });

    if (selected) {
      setSelectedProducts(selected);
    }
  }

  const saveProducts = () => {
    const formData = new FormData();

    formData.append(
      "productIds",
      JSON.stringify(selectedProducts.map((product) => product.id)),
    );
    fetcher.submit(formData, { method: "POST" });
  };

  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.ok) {
      shopify.toast.show("Products saved to shop metafield");
    } else if (fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const isSaving = fetcher.state !== "idle";

  return (
    <s-page heading="Home">
      <s-stack gap="base">
        <s-heading>Bundle builder app</s-heading>
        <s-divider></s-divider>
        <s-button onClick={selectProducts}>Select products</s-button>
        {displayedProducts.length > 0 && (
          <>
            <s-card title="Selected products">
              <s-list>
                {displayedProducts.map((product) => (
                  <s-list-item key={product.id}>{product.title}</s-list-item>
                ))}
              </s-list>
            </s-card>
            {selectedProducts.length > 0 && (
              <s-button
                disabled={isSaving}
                loading={isSaving}
                onClick={saveProducts}
                variant="primary"
              >
                Save
              </s-button>
            )}
          </>
        )}
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
