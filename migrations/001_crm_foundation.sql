CREATE TABLE IF NOT EXISTS crm_security_guard (
 id TINYINT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT IGNORE INTO crm_security_guard (id, revision) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS crm_users (
 id CHAR(36) PRIMARY KEY, full_name VARCHAR(160) NOT NULL,
 email_normalized VARCHAR(254) NOT NULL UNIQUE, status VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED',
 email_verified_at DATETIME(3) NULL, bootstrap_completed BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 updated_by CHAR(36) NULL, INDEX crm_users_status_idx (status),
 CONSTRAINT crm_users_actor_fk FOREIGN KEY (updated_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_roles (
 code VARCHAR(64) PRIMARY KEY, name VARCHAR(100) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 protected BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_permissions (
 code VARCHAR(64) PRIMARY KEY, name VARCHAR(120) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_user_roles (
 user_id CHAR(36) NOT NULL, role_code VARCHAR(64) NOT NULL, assigned_by CHAR(36) NULL,
 assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (user_id, role_code), INDEX crm_ur_role_idx (role_code), INDEX crm_ur_actor_idx (assigned_by),
 CONSTRAINT crm_ur_user_fk FOREIGN KEY (user_id) REFERENCES crm_users(id),
 CONSTRAINT crm_ur_role_fk FOREIGN KEY (role_code) REFERENCES crm_roles(code),
 CONSTRAINT crm_ur_actor_fk FOREIGN KEY (assigned_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_role_permissions (
 role_code VARCHAR(64) NOT NULL, permission_code VARCHAR(64) NOT NULL, PRIMARY KEY(role_code, permission_code), INDEX crm_rp_perm_idx (permission_code),
 CONSTRAINT crm_rp_role_fk FOREIGN KEY (role_code) REFERENCES crm_roles(code),
 CONSTRAINT crm_rp_perm_fk FOREIGN KEY (permission_code) REFERENCES crm_permissions(code)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_role_requests (
 user_id CHAR(36) PRIMARY KEY, role_code VARCHAR(64) NOT NULL, requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 reviewed_at DATETIME(3) NULL, reviewed_by CHAR(36) NULL, INDEX crm_rr_role_idx (role_code), INDEX crm_rr_actor_idx (reviewed_by),
 CONSTRAINT crm_rr_user_fk FOREIGN KEY (user_id) REFERENCES crm_users(id),
 CONSTRAINT crm_rr_role_fk FOREIGN KEY (role_code) REFERENCES crm_roles(code),
 CONSTRAINT crm_rr_actor_fk FOREIGN KEY (reviewed_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_auth_credentials (
 user_id CHAR(36) PRIMARY KEY, password_hash VARCHAR(300) NOT NULL,
 changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT crm_cred_user_fk FOREIGN KEY (user_id) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_auth_sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, csrf_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), expires_at DATETIME(3) NOT NULL,
 INDEX crm_session_user_idx (user_id), INDEX crm_session_expiry_idx (expires_at),
 CONSTRAINT crm_session_user_fk FOREIGN KEY (user_id) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_auth_tokens (
 token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, purpose VARCHAR(12) NOT NULL,
 expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX crm_token_user_purpose_idx (user_id, purpose), INDEX crm_token_expiry_idx (expires_at),
 CONSTRAINT crm_token_user_fk FOREIGN KEY (user_id) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_auth_rate_limits (
 bucket_hash CHAR(64) PRIMARY KEY, attempts INT NOT NULL, window_start DATETIME(3) NOT NULL,
 INDEX crm_rate_time_idx (window_start)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_business_regions (
 code VARCHAR(12) PRIMARY KEY, name VARCHAR(120) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_countries (
 code CHAR(2) PRIMARY KEY, name VARCHAR(120) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_country_regions (
 country_code CHAR(2) PRIMARY KEY, region_code VARCHAR(12) NOT NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), updated_by CHAR(36) NULL,
 INDEX crm_cr_region_idx (region_code), INDEX crm_cr_actor_idx (updated_by),
 CONSTRAINT crm_cr_country_fk FOREIGN KEY (country_code) REFERENCES crm_countries(code),
 CONSTRAINT crm_cr_region_fk FOREIGN KEY (region_code) REFERENCES crm_business_regions(code),
 CONSTRAINT crm_cr_actor_fk FOREIGN KEY (updated_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_company (
 id TINYINT PRIMARY KEY, trading_name VARCHAR(240) NULL, legal_name VARCHAR(240) NULL, logo_url VARCHAR(2048) NULL,
 website VARCHAR(2048) NULL, email VARCHAR(254) NULL, phone VARCHAR(60) NULL, country_code CHAR(2) NULL,
 address_line1 VARCHAR(240) NULL, city VARCHAR(120) NULL, state VARCHAR(120) NULL, postal_code VARCHAR(32) NULL,
 timezone VARCHAR(80) NOT NULL DEFAULT 'UTC', default_currency CHAR(3) NOT NULL DEFAULT 'USD', description TEXT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), updated_by CHAR(36) NULL,
 INDEX crm_company_country_idx (country_code), INDEX crm_company_actor_idx (updated_by),
 CONSTRAINT crm_company_country_fk FOREIGN KEY (country_code) REFERENCES crm_countries(code),
 CONSTRAINT crm_company_actor_fk FOREIGN KEY (updated_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_customers (
 id CHAR(36) PRIMARY KEY, display_name VARCHAR(200) NOT NULL, legal_name VARCHAR(240) NULL,
 customer_type VARCHAR(64) NOT NULL, legal_entity_type VARCHAR(64) NULL, country_code CHAR(2) NOT NULL,
 email VARCHAR(254) NULL, phone VARCHAR(60) NULL, website VARCHAR(2048) NULL, tax_id VARCHAR(100) NULL,
 address_line1 VARCHAR(240) NULL, address_line2 VARCHAR(240) NULL, city VARCHAR(120) NULL, state VARCHAR(120) NULL, postal_code VARCHAR(32) NULL, notes TEXT NULL,
 status VARCHAR(12) NOT NULL DEFAULT 'ACTIVE', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 created_by CHAR(36) NOT NULL, updated_by CHAR(36) NOT NULL,
 INDEX crm_customer_country_idx (country_code), INDEX crm_customer_type_status_idx (customer_type, status),
 INDEX crm_customer_display_idx (display_name), INDEX crm_customer_email_idx (email), INDEX crm_customer_created_idx (created_at),
 INDEX crm_customer_creator_idx (created_by), INDEX crm_customer_actor_idx (updated_by),
 CONSTRAINT crm_customer_country_fk FOREIGN KEY (country_code) REFERENCES crm_countries(code),
 CONSTRAINT crm_customer_creator_fk FOREIGN KEY (created_by) REFERENCES crm_users(id),
 CONSTRAINT crm_customer_actor_fk FOREIGN KEY (updated_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_customer_contacts (
 id CHAR(36) PRIMARY KEY, customer_id CHAR(36) NOT NULL, salutation VARCHAR(12) NULL, full_name VARCHAR(160) NOT NULL,
 alias VARCHAR(120) NULL, job_title VARCHAR(160) NULL, phone VARCHAR(60) NULL, email VARCHAR(254) NULL, is_primary BOOLEAN NOT NULL DEFAULT FALSE,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), created_by CHAR(36) NOT NULL, updated_by CHAR(36) NOT NULL,
 INDEX crm_contact_customer_primary_idx (customer_id, is_primary), INDEX crm_contact_creator_idx (created_by), INDEX crm_contact_actor_idx (updated_by),
 CONSTRAINT crm_contact_customer_fk FOREIGN KEY (customer_id) REFERENCES crm_customers(id),
 CONSTRAINT crm_contact_creator_fk FOREIGN KEY (created_by) REFERENCES crm_users(id),
 CONSTRAINT crm_contact_actor_fk FOREIGN KEY (updated_by) REFERENCES crm_users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS crm_audit_logs (
 id CHAR(36) PRIMARY KEY, actor_id CHAR(36) NULL, action VARCHAR(80) NOT NULL, entity_type VARCHAR(40) NOT NULL, entity_id VARCHAR(64) NULL,
 metadata JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX crm_audit_created_idx (created_at), INDEX crm_audit_actor_idx (actor_id), INDEX crm_audit_entity_idx (entity_type, entity_id),
 CONSTRAINT crm_audit_actor_fk FOREIGN KEY (actor_id) REFERENCES crm_users(id)
) ENGINE=InnoDB;
