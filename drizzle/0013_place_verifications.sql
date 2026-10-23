CREATE TABLE `place_verifications` (
	`id` varchar(128) NOT NULL,
	`kind` enum('pharmacy','healthcare') NOT NULL,
	`status` enum('verified','needs_visit') NOT NULL,
	`positionConfirmed` boolean NOT NULL DEFAULT false,
	`note` text,
	`checkedBy` int NOT NULL,
	`checkedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `place_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `place_verifications_status_idx` ON `place_verifications` (`status`);