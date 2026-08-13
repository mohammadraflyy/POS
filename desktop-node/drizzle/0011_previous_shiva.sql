ALTER TABLE `users` ADD `role` text DEFAULT 'kasir' NOT NULL;--> statement-breakpoint
-- every account that existed before roles did was an unrestricted one, so it stays
-- unrestricted - defaulting them to 'kasir' would lock the owner out of their own app
UPDATE `users` SET `role` = 'admin';