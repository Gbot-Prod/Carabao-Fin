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
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        className={`w-full cursor-pointer rounded-[var(--radius-md)] border p-3 text-left transition ${isSelected
          ? 'border-emerald-500 bg-emerald-50 shadow-[0_0_0_1px_var(--color-emerald-500)]'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
          }`}
      >
        <div className="flex items-center gap-3">
          {order.image ? (
            <Image
              className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] object-cover"
              src={order.image}
              alt={order.merchant}
              width={48}
              height={48}
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-emerald-100 text-sm font-semibold text-emerald-700">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">{order.merchant}</p>
            <p className="text-xs text-gray-500">Bought {order.dateBought}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${order.shipped
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
              }`}
          >
            {order.shipped ? 'Shipped' : 'Not shipped'}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-xs">
          <span className="text-gray-500">
            ETA <span className="font-medium text-gray-800">{order.shipped ? order.timeOfArrival : 'Pending'}</span>
          </span>
          <span className="text-gray-500">
            Fee <span className="font-medium text-gray-800">{deliveryFee}</span>
          </span>
        </div>
      </button>
    </li>
  );
}
