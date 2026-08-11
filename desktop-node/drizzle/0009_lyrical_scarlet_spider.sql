ALTER TABLE `sale_items` ADD `base_quantity` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `price_source` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
-- Every past line already recorded qty and the konversi it was sold at, so the
-- base-unit quantity is recoverable exactly rather than being left at 0.
-- price_source is deliberately not backfilled: there is no way to tell after the
-- fact whether an old price came from a tier, so every historical row keeps the
-- column default of 'normal'.
UPDATE sale_items SET base_quantity = qty * konversi;