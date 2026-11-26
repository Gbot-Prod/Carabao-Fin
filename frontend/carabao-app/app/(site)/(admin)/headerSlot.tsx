"use client";

import { createContext, useContext } from "react";

/**
 * The element in the admin topbar that PageHeader renders into, so each
 * page's eyebrow, title, count, description and actions live in the topbar
 * rather than in a block of their own at the top of the page.
 */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export const useHeaderSlot = () => useContext(HeaderSlotContext);
