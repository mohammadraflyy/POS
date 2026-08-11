CREATE TABLE `stock_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`product_unit_id` integer,
	`quantity` integer NOT NULL,
	`conversion_factor` integer NOT NULL,
	`base_quantity` integer NOT NULL,
	`movement_type` text NOT NULL,
	`reference_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_unit_id`) REFERENCES `product_units`(`id`) ON UPDATE no action ON DELETE set null
);
