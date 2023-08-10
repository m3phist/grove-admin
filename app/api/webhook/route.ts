import Stripe from 'stripe';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import prismadb from '@/lib/prismadb';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('Stripe-Signature') as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: any) {
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const address = session?.customer_details?.address;

  const addressComponents = [
    address?.line1,
    address?.line2,
    address?.city,
    address?.state,
    address?.postal_code,
    address?.country,
  ];

  const addressString = addressComponents.filter((c) => c !== null).join(', ');

  if (event.type === 'checkout.session.completed') {
    const orderId = session?.metadata?.orderId;

    try {
      const order = await prismadb.order.update({
        where: {
          id: orderId,
        },
        data: {
          isPaid: true,
          address: addressString,
          phone: session?.customer_details?.phone || '',
        },
        include: {
          orderItems: true,
        },
      });

      const productIds = order.orderItems.map(
        (orderItem) => orderItem.productId
      );

      await Promise.all(
        productIds.map(async (productId: string) => {
          try {
            const product = await prismadb.product.findUnique({
              where: {
                id: productId,
              },
            });

            if (product) {
              if (product.unit > 0) {
                await prismadb.product.update({
                  where: {
                    id: productId,
                  },
                  data: {
                    unit: product.unit - 1,
                    isArchived: product.unit - 1 === 0,
                  },
                });
              }
            }
          } catch (productError) {
            console.error('Error updating product:', productError);
          }
        })
      );
    } catch (orderError) {
      console.error('Error updating order:', orderError);
    }
  }

  return new NextResponse(null, { status: 200 });
}
