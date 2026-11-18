CREATE TABLE `care_events` (
	`id` text PRIMARY KEY NOT NULL,
	`plant_id` text NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plant_id`) REFERENCES `plants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `care_events_plant_idx` ON `care_events` (`plant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`slot` text NOT NULL,
	`household_id` text NOT NULL,
	`plant_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`slot`, `household_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
