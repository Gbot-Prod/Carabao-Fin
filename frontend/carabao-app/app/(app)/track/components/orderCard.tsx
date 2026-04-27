'use client';

import React from 'react';
import Image from 'next/image';

export interface Order {
  merchant: string;
  shipped: boolean;
  dateBought: string;
  timeOfArrival: string;
  deliveryFee: number;
  image: string;
}

interface OrderCardProps {
  order: Order;
  onClick?: () => void;
  isSelected?: boolean;
}

export default function OrderCard({ order, onClick, isSelected = false }: OrderCardProps) {
  const deliveryFee = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(order.deliveryFee);

  const initials = order.merchant.slice(0, 2).toUpperCase();

  return (
    <li
      onClick={onClick}
      className={`w-full cursor-pointer rounded-2xl border p-2 overflow-hidden transition ${isSelected
        ? 'border-emerald-500 bg-emerald-50'
        : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {order.image ? (
            <Image
              className="h-14 w-14 rounded-xl object-cover"
              src={order.image}
              alt={order.merchant}
              width={56}
              height={56}
            />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm shrink-0">
              {initials}
            </div>
          )}
          <div>
            <p className="text-base font-semibold text-gray-900">{order.merchant}</p>
            <p className="text-sm text-gray-500">Bought: {order.dateBought}</p>
            <p className="text-sm text-gray-500">
              ETA: {order.shipped ? order.timeOfArrival : 'Pending shipment'}
            </p>
          </div>
        </div>
        <span
          className={`rounded-lg px-2 py-1 text-xs font-medium ${isSelected ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'
            }`}
        >
          {isSelected ? 'Selected' : 'Open'}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span
          className={`inline-flex rounded-lg px-1 py-1 text-xs font-medium ${order.shipped
            ? ' bg-emerald-100 text-emerald-700'
            : 'bg-amber-100 text-amber-700'
            }`}
        >
          {order.shipped ? 'Shipped' : 'Not shipped'}
        </span>
        <p className="text-sm font-semibold text-gray-800">Delivery fee: {deliveryFee}</p>
      </div>
    </li>
  );
}
