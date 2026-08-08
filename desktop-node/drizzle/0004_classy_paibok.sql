ALTER TABLE `purchase_items` ADD `product_unit_id` integer REFERENCES product_units(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `konversi` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_items` ADD `satuan` text;