import prismadb from '@/lib/prismadb';

export const getStockCount = async (storeId: string) => {
  const products = await prismadb.product.findMany({
    where: {
      storeId,
      unit: {
        gt: 0,
      },
    },
    select: {
      unit: true,
    },
  });

  const totalUnits = products.reduce((sum, product) => sum + product.unit, 0);

  return totalUnits;
};
