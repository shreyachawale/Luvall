import type { FieldDef } from "@/components/admin/crud";
import { titleCase } from "@/lib/format";

export const STUDENT_FIELDS: FieldDef[] = [
  { name: "name", label: "Full name", required: true },
  { name: "mobile", label: "Mobile", required: true },
  { name: "email", label: "Email" },
  { name: "password", label: "Login password", hint: "Optional — leave blank if the student won't sign in yet" },
  { name: "skill_level", label: "Skill level", type: "select", options: ["beginner", "intermediate", "advanced"].map((v) => ({ value: v, label: titleCase(v) })) },
  { name: "dob", label: "Date of birth", type: "date" },
  { name: "gender", label: "Gender", type: "select", options: [{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }] },
  { name: "guardian_name", label: "Parent / guardian" },
  { name: "emergency_contact", label: "Emergency contact" },
  { name: "joined_date", label: "Joined on", type: "date" },
  { name: "opening_balance", label: "Opening balance (₹)", type: "number", hint: "Migrated balance: positive = credit, negative = dues" },
  { name: "address", label: "Address", type: "textarea" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export const COACH_FIELDS: FieldDef[] = [
  { name: "name", label: "Full name", required: true },
  { name: "mobile", label: "Mobile", required: true },
  { name: "email", label: "Email" },
  { name: "title", label: "Title", placeholder: "Head Coach" },
  { name: "experience_years", label: "Years of experience", type: "number" },
  { name: "specialties", label: "Specialties" },
  { name: "certifications", label: "Certifications", type: "textarea" },
  { name: "profile_bio", label: "Public bio", type: "textarea" },
  { name: "photo_url", label: "Photo", type: "image" },
  { name: "display_order", label: "Display order", type: "number", default: 0 },
  { name: "is_public", label: "Show on the public website", type: "checkbox", default: true },
];

export const VENUE_FIELDS: FieldDef[] = [
  { name: "code", label: "Code", required: true, placeholder: "CSA" },
  { name: "name", label: "Venue name", required: true },
  { name: "address", label: "Address", full: true },
  { name: "city", label: "City" },
  { name: "courts_available", label: "Courts available", type: "number", default: 1, required: true },
  { name: "owner_name", label: "Owner / manager" },
  { name: "contact_no", label: "Contact number" },
  { name: "map_url", label: "Google Maps link", type: "url", full: true },
  { name: "amenities", label: "Amenities", full: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "photo_url", label: "Photo", type: "image" },
  { name: "is_public", label: "Show on the public website", type: "checkbox", default: true },
  { name: "status", label: "Status", type: "select", required: true, default: "active", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
];

export const PAY_METHODS = ["bank_transfer", "upi", "cash", "other"].map((v) => ({ value: v, label: titleCase(v) }));
