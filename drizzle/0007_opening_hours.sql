CREATE TABLE `city_hours` (
	`city` varchar(96) NOT NULL,
	`openingHours` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `city_hours_city` PRIMARY KEY(`city`)
);
--> statement-breakpoint
ALTER TABLE `directory_entries` ADD `openingHours` text;