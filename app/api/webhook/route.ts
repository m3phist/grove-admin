import Stripe from 'stripe';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { stripe } from '@/lib/stripe';
import prismadb from '@/lib/prismadb';

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('Stripe-Signature') as string;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const client = require('twilio')(accountSid, authToken);

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

      console.log('Product IDs:', productIds);

      const updatedProducts: Array<any> = [];

      // Fetch and update products
      for (const productId of productIds) {
        try {
          const product = await prismadb.product.findUnique({
            where: {
              id: productId,
            },
          });

          if (product && product.unit > 0) {
            const updatedProduct = {
              ...product,
              unit: product.unit - 1,
              isArchived: product.unit === 1,
            };

            updatedProducts.push(updatedProduct);
          }
        } catch (productError) {
          console.error('Error updating product:', productError);
        }
      }

      console.log('Updated products:', updatedProducts);

      const soldOutProducts = updatedProducts
        .filter((product) => product.isArchived)
        .map((product) => product.name)
        .join(', ');

      if (soldOutProducts.length > 0) {
        console.log('Sold out products:', soldOutProducts);

        const messageBody = `The following products are sold out and archived: ${soldOutProducts}`;

        await client.messages
          .create({
            body: messageBody,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: process.env.MY_PHONE_NUMBER,
          })
          .then((message: any) =>
            console.log('WhatsApp message sent:', message.sid)
          )
          .catch((error: any) =>
            console.error('Error sending WhatsApp message:', error)
          );
      }
    } catch (orderError) {
      console.error('Error updating order:', orderError);
    }
  }

  return new NextResponse(null, { status: 200 });
}
