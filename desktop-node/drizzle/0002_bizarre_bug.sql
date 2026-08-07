DROP INDEX IF EXISTS `product_units_product_id_satuan_unique`;--> statement-breakpoint
ALTER TABLE `product_units` ADD `level` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `product_units` ADD `jumlah_kemasan` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `product_units_product_id_level_unique` ON `product_units` (`product_id`,`level`);