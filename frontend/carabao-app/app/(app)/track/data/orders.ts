export interface Order {
  merchant: string;
  shipped: boolean;
  dateBought: string;
  timeOfArrival: string;
  deliveryFee: number;
  image: string;
}

export const orders: Order[] = [
  {
    merchant: 'DOLE',
    shipped: false,
    dateBought: '09/03/26',
    timeOfArrival: 'N/A',
    deliveryFee: 356,
    image: '/images/farms/dole.png'
  },

  {
    merchant: 'DIZON',
    shipped: true,
    dateBought: '02/03/26',
    timeOfArrival: '08/03/26',
    deliveryFee: 4000,
    image: '/images/farms/dizon.png'
  },
];

