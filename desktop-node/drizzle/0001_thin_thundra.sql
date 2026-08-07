ALTER TABLE `store_settings` ADD `printer_name` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `receipt_width` text DEFAULT '58mm' NOT NULL;