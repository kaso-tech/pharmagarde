CREATE TABLE `duty_exceptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`city` varchar(96) NOT NULL,
	`weekStart` varchar(10) NOT NULL,
	`pharmacyId` varchar(128) NOT NULL,
	`action` enum('add','remove') NOT NULL,
	`note` varchar(255),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `duty_exceptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `duty_rotations` (
	`city` varchar(96) NOT NULL,
	`mode` enum('groups','lists','off') NOT NULL,
	`groupCount` int,
	`referenceStart` varchar(10) NOT NULL,
	`referenceTurnIndex` int NOT NULL,
	`turns` text,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `duty_rotations_city` PRIMARY KEY(`city`)
);
--> statement-breakpoint
CREATE INDEX `duty_exceptions_week_idx` ON `duty_exceptions` (`weekStart`,`city`);