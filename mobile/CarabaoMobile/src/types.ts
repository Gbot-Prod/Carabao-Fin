export type RootStackParamList = {
  Auth: undefined;
  MainTabs: { screen?: keyof TabParamList } | undefined;
  Merchant: { farmId: string; farmName: string };
  Checkout: undefined;
  Confirmation: { orderId: string };
  Onboarding: undefined;
};

export type TabParamList = {
  Order: undefined;
  Cart: undefined;
  Track: undefined;
  History: undefined;
  Profile: undefined;
};

export interface Order {
  id: string;
  merchant: string;
  dateBought: string;
  status: string;
  totalAmount: number;
  deliveryFee: number;
  timeOfArrival: string;
  shipped: boolean;
  image: string;
}
