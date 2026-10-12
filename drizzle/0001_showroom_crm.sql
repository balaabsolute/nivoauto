CREATE TABLE "car_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body_type" text,
	"fuel_types" text,
	"price_band" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_to_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'call' NOT NULL,
	"reason" text NOT NULL,
	"model_update_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" uuid,
	"outcome_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"variant" text,
	"colour" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_no" text NOT NULL,
	"dealership_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"source" text NOT NULL,
	"walk_in_id" uuid,
	"consultant_id" uuid,
	"stage" text DEFAULT 'enquiry' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"timeframe" text,
	"budget_min" numeric(16, 2),
	"budget_max" numeric(16, 2),
	"fuel_preference" text,
	"finance_needed" boolean,
	"exchange_vehicle" text,
	"next_follow_up_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"lost_to_brand" text,
	"lost_to_model" text,
	"lost_to_dealer" text,
	"close_reason" text,
	"won_invoice_ref" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_lead_no_unique" UNIQUE("lead_no")
);
--> statement-breakpoint
CREATE TABLE "lounge_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealership_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kiosk_user_id" uuid,
	"current_make" text,
	"current_model" text,
	"registration_no" text,
	"purchase_year" integer,
	"service_rating" integer,
	"interest" text NOT NULL,
	"timeframe" text,
	"budget_band" text,
	"preferred_body_type" text,
	"preferred_fuel" text,
	"preferred_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"other_preferences" text,
	"comments" text,
	"status" text DEFAULT 'new' NOT NULL,
	"converted_lead_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"dealership_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"valid_until" date,
	"include_prospects" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"tasks_created" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"published_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_drives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"licence_checked" boolean DEFAULT false NOT NULL,
	"rating" integer,
	"notes" text,
	"consultant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "walk_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealership_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"visit_type" text NOT NULL,
	"token" text NOT NULL,
	"business_date" date NOT NULL,
	"captured_via" text NOT NULL,
	"kiosk_user_id" uuid,
	"registration_no" text,
	"vehicle_model" text,
	"request" text,
	"insurance_claim" boolean,
	"status" text DEFAULT 'waiting' NOT NULL,
	"attended_by_id" uuid,
	"attended_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"outcome_note" text,
	"lead_id" uuid,
	"job_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "consent_marketing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "car_models" ADD CONSTRAINT "car_models_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interests" ADD CONSTRAINT "lead_interests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interests" ADD CONSTRAINT "lead_interests_model_id_car_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."car_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lounge_feedback" ADD CONSTRAINT "lounge_feedback_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lounge_feedback" ADD CONSTRAINT "lounge_feedback_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lounge_feedback" ADD CONSTRAINT "lounge_feedback_kiosk_user_id_users_id_fk" FOREIGN KEY ("kiosk_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_updates" ADD CONSTRAINT "model_updates_model_id_car_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."car_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_updates" ADD CONSTRAINT "model_updates_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_updates" ADD CONSTRAINT "model_updates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_drives" ADD CONSTRAINT "test_drives_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_drives" ADD CONSTRAINT "test_drives_model_id_car_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."car_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_drives" ADD CONSTRAINT "test_drives_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_kiosk_user_id_users_id_fk" FOREIGN KEY ("kiosk_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walk_ins" ADD CONSTRAINT "walk_ins_attended_by_id_users_id_fk" FOREIGN KEY ("attended_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "car_models_brand_name_uq" ON "car_models" USING btree ("brand_id","name");--> statement-breakpoint
CREATE INDEX "follow_ups_assignee_idx" ON "follow_ups" USING btree ("assigned_to_id","status","due_at");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_interests_uq" ON "lead_interests" USING btree ("lead_id","model_id");--> statement-breakpoint
CREATE INDEX "leads_dealer_status_idx" ON "leads" USING btree ("dealership_id","status");--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "lounge_feedback_dealer_idx" ON "lounge_feedback" USING btree ("dealership_id","created_at");--> statement-breakpoint
CREATE INDEX "walk_ins_dealer_date_idx" ON "walk_ins" USING btree ("dealership_id","business_date");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;