#import "theme.typ": *

#let theme = "summary"

#show: conf.with(theme: "summary", provenance: "Shared by the patient via SMART Health Link — June 10, 2026")

#title-block(theme: theme, title: "Health Summary", subtitle: "FHIR-rendered patient summary — for cardiology consultation", meta: (("Patient", "Jessica Argonaut"), ("DOB", "1985-03-14"), ("Generated", "2026-06-10"),))

#kv-panel(theme: theme, (("Name", "Jessica Argonaut"), ("DOB", "1985-03-14"), ("Sex", "Female"), ("MRN", "EH-4421087"), ("Generated", "2026-06-10"),))

#callout(theme: theme, title: "How this document was shared", ("Shared by the patient via SMART Health Link — June 10, 2026. ", "The patient shared this document directly with you via a SMART Health Link, a secure, patient-controlled link to their verifiable health records.",).join())

#heading(level: 2, "Problems")

#data-table(
  theme: theme,
  size: 8.5pt,
  columns: (1fr, auto, auto,),
  align: auto,
  header: ("Condition", "Clinical status", "Onset",),
  rows: (
    ("Paroxysmal palpitations, under evaluation (suspected supraventricular tachycardia)", badge("active", "active"), "2024-05",),
    ("Essential hypertension", badge("active", "active"), "2025-05",),
    ("Hyperlipidemia", badge("active", "active"), "2025-11",),
    ("Iron deficiency anemia", badge("active", "active"), "2026-01",),
    ("Hypothyroidism (Hashimoto’s thyroiditis)", badge("active", "active"), "2019-03",),
    ("Generalized anxiety disorder", badge("active", "active"), "2023-08",),
    ("Migraine without aura", badge("active", "active"), "2015-06",),
    ("Seasonal allergic rhinitis", badge("active", "active"), "2010-04",),
    ("Gastroesophageal reflux disease", badge("active", "active"), "2025-09",),
    ("Suspected obstructive sleep apnea, study pending", badge("active", "active"), "2026-04",),
    ("Mild intermittent asthma", badge("inactive", "inactive"), "1998-09",),
    ("Acute sinusitis", badge("resolved", "resolved"), "2026-01",),
  ),
)

#heading(level: 2, "Medications")

#data-table(
  theme: theme,
  size: 7.8pt,
  columns: (1.35fr, 0.75fr, 2.6fr, auto, auto, 0.95fr,),
  align: auto,
  header: ("Medication", "Dose", "Sig (instructions)", "Status", "Authored", "Prescriber",),
  rows: (
    ("Metoprolol succinate ER", "25 mg", "Take 1 tablet by mouth once daily in the morning.", badge("active", "active"), "2026-03-02", "Dr. Priya Raman",),
    ("Lisinopril", "10 mg", "Take 1 tablet by mouth once daily.", badge("active", "active"), "2025-11-18", "Dr. Alan Okafor",),
    ("Atorvastatin", "20 mg", "Take 1 tablet by mouth every evening at bedtime.", badge("active", "active"), "2025-11-18", "Dr. Alan Okafor",),
    ("Levothyroxine", "75 mcg", "Take 1 tablet by mouth once daily on an empty stomach, at least 30 minutes before breakfast and at least 4 hours apart from any calcium, iron, or magnesium supplements; do not switch manufacturers without contacting the prescribing physician, as small differences in formulation can change effective dose; recheck TSH 6-8 weeks after any dose or brand change.", badge("active", "active"), "2024-06-30", "Dr. Alan Okafor",),
    ("Sertraline", "50 mg", "Take 1 tablet by mouth once daily in the morning with food.", badge("active", "active"), "2024-09-12", "Dr. Maya Lindqvist",),
    ("Albuterol HFA inhaler", "90 mcg/actuation", "Inhale 2 puffs by mouth every 4 to 6 hours as needed for wheezing or shortness of breath; shake well before use; rinse mouth after.", badge("active", "active"), "2025-04-22", "Dr. Alan Okafor",),
    ("Fluticasone propionate nasal spray", "50 mcg/spray", "1 spray in each nostril once daily during allergy season.", badge("active", "active"), "2026-04-01", "Dr. Alan Okafor",),
    ("Cetirizine", "10 mg", "Take 1 tablet by mouth once daily as needed for allergies.", badge("active", "active"), "2026-04-01", "Dr. Alan Okafor",),
    ("Omeprazole", "20 mg", "Take 1 capsule by mouth once daily before breakfast for 8 weeks, then reassess; do not crush or chew.", badge("active", "active"), "2026-02-09", "Dr. Alan Okafor",),
    ("Ferrous sulfate", "325 mg (65 mg elemental iron)", "Take 1 tablet by mouth every other day with a glass of orange juice or other source of vitamin C to improve absorption; take on an empty stomach if tolerated, otherwise with a small amount of food; avoid taking within 2 hours of antacids, dairy products, coffee, tea, or levothyroxine; expect dark stools, which are harmless; contact the office if constipation becomes severe or if abdominal pain persists for more than a few days.", badge("active", "active"), "2026-01-15", "Dr. Alan Okafor",),
    ("Vitamin D3 (cholecalciferol)", "2000 IU", "Take 1 capsule by mouth once daily with the largest meal of the day.", badge("active", "active"), "2025-01-10", "Dr. Alan Okafor",),
    ("Magnesium glycinate", "120 mg", "Take 2 capsules by mouth at bedtime.", badge("active", "active"), "2026-03-02", "Dr. Priya Raman",),
    ("Aspirin", "81 mg", "Take 1 tablet by mouth once daily — HOLD pending cardiology evaluation per Dr. Raman’s note of 2026-03-02.", badge("active", "active"), "2026-03-02", "Dr. Priya Raman",),
    ("Sumatriptan", "50 mg", "Take 1 tablet by mouth at onset of migraine; may repeat once after 2 hours; maximum 200 mg in 24 hours; do not use within 24 hours of another triptan or ergot.", badge("active", "active"), "2025-08-05", "Dr. Maya Lindqvist",),
    ("Ondansetron ODT", "4 mg", "Dissolve 1 tablet on tongue every 8 hours as needed for nausea.", badge("active", "active"), "2025-08-05", "Dr. Maya Lindqvist",),
    ("Melatonin", "3 mg", "Take 1 tablet by mouth 30 minutes before bedtime as needed for sleep.", badge("active", "active"), "2025-10-20", "Dr. Maya Lindqvist",),
    ("Norethindrone", "0.35 mg", "Take 1 tablet by mouth at the same time every day, with no pill-free interval.", badge("active", "active"), "2025-07-14", "Dr. Hannah Choi",),
    ("Triamcinolone 0.1% cream", "0.1%", "Apply a thin layer to affected area twice daily for up to 14 days; avoid face and skin folds.", badge("active", "active"), "2026-05-11", "Dr. Alan Okafor",),
    ("Artificial tears (carboxymethylcellulose 0.5%)", "0.5% ophthalmic solution", "Instill 1-2 drops in each eye up to 4 times daily as needed for dryness.", badge("active", "active"), "2025-12-03", "Dr. Alan Okafor",),
    ("Ibuprofen", "600 mg", "Take 1 tablet by mouth every 8 hours as needed for pain, with food; do not exceed 3 tablets in 24 hours; avoid if stomach upset develops.", badge("active", "active"), "2026-05-11", "Dr. Alan Okafor",),
    ("Propranolol", "10 mg", "Take 1 tablet by mouth twice daily — stopped 2026-03-02 when metoprolol was started.", badge("stopped", "stopped"), "2025-09-30", "Dr. Alan Okafor",),
    ("Hydrochlorothiazide", "25 mg", "Take 1 tablet by mouth once daily in the morning.", badge("stopped", "stopped"), "2025-05-19", "Dr. Alan Okafor",),
    ("Escitalopram", "10 mg", "Take 1 tablet by mouth once daily; cross-tapered to sertraline September 2024 due to fatigue.", badge("stopped", "stopped"), "2023-11-02", "Dr. Maya Lindqvist",),
    ("Zolpidem", "5 mg", "Take 1 tablet by mouth at bedtime as needed for insomnia; do not take unless able to sleep 7-8 hours.", badge("stopped", "stopped"), "2024-02-14", "Dr. Maya Lindqvist",),
    ("Combined oral contraceptive (ethinyl estradiol/norgestimate)", "0.035 mg/0.25 mg", "Take 1 tablet by mouth daily as directed on pack; discontinued in favor of progestin-only pill given palpitation workup.", badge("stopped", "stopped"), "2022-03-08", "Dr. Hannah Choi",),
    ("Pantoprazole", "40 mg", "Take 1 tablet by mouth once daily before breakfast; switched to omeprazole per formulary.", badge("stopped", "stopped"), "2025-10-01", "Dr. Alan Okafor",),
    ("Naproxen", "500 mg", "Take 1 tablet by mouth twice daily with food as needed for pain.", badge("stopped", "stopped"), "2024-07-22", "Dr. Alan Okafor",),
    ("Montelukast", "10 mg", "Take 1 tablet by mouth every evening; discontinued due to vivid dreams.", badge("stopped", "stopped"), "2024-04-09", "Dr. Alan Okafor",),
    ("Doxycycline hyclate", "100 mg", "Take 1 capsule by mouth twice daily for 10 days with a full glass of water; remain upright for 30 minutes after each dose; avoid prolonged sun exposure and use sunscreen, as this medication can cause significant photosensitivity; take 2 hours apart from dairy, antacids, iron, and multivitamins.", badge("completed", "completed"), "2026-04-18", "Dr. Alan Okafor",),
    ("Amoxicillin-clavulanate", "875-125 mg", "Take 1 tablet by mouth twice daily for 7 days with food.", badge("completed", "completed"), "2026-01-28", "Dr. Alan Okafor",),
    ("Azithromycin", "250 mg", "Take 2 tablets by mouth on day 1, then 1 tablet daily on days 2 through 5.", badge("completed", "completed"), "2025-12-15", "Dr. Alan Okafor",),
    ("Prednisone taper", "20 mg", "Take 20 mg daily for 3 days, then 10 mg daily for 3 days, then 5 mg daily for 3 days, then stop.", badge("completed", "completed"), "2025-04-22", "Dr. Alan Okafor",),
    ("Nitrofurantoin monohydrate/macrocrystals", "100 mg", "Take 1 capsule by mouth twice daily for 5 days with food.", badge("completed", "completed"), "2025-06-08", "Dr. Hannah Choi",),
    ("Fluconazole", "150 mg", "Take 1 tablet by mouth as a single dose; may repeat in 72 hours if symptoms persist.", badge("completed", "completed"), "2025-06-12", "Dr. Hannah Choi",),
    ("Oseltamivir", "75 mg", "Take 1 capsule by mouth twice daily for 5 days.", badge("completed", "completed"), "2025-01-30", "Dr. Alan Okafor",),
    ("Cyclobenzaprine", "5 mg", "Take 1 tablet by mouth at bedtime as needed for muscle spasm, for up to 2 weeks; may cause drowsiness — do not drive after taking.", badge("completed", "completed"), "2024-10-05", "Dr. Alan Okafor",),
    ("Mupirocin 2% ointment", "2%", "Apply to affected area three times daily for 10 days.", badge("completed", "completed"), "2024-08-19", "Dr. Alan Okafor",),
    ("Ketorolac", "10 mg", "Take 1 tablet by mouth every 6 hours as needed for severe pain; maximum 5 days total; do not combine with other NSAIDs.", badge("completed", "completed"), "2024-05-27", "Dr. Hannah Choi",),
    ("Cephalexin", "500 mg", "Take 1 capsule by mouth four times daily for 7 days.", badge("completed", "completed"), "2023-09-11", "Dr. Alan Okafor",),
    ("Tramadol", "50 mg", "Take 1 tablet by mouth every 6 hours as needed for moderate pain; maximum 4 tablets in 24 hours; may cause dizziness or drowsiness; do not combine with alcohol or other sedating medications; taper if used more than 2 weeks.", badge("completed", "completed"), "2023-05-04", "Dr. Hannah Choi",),
  ),
)

#heading(level: 2, "Laboratory Results")

#data-table(
  theme: theme,
  size: 8pt,
  columns: (2.1fr, auto, auto, auto, auto, auto,),
  align: auto,
  header: ("Test", "Value", "Unit", "Reference range", "Flag", "Date",),
  rows: (
    ("Hemoglobin", "10.9", "g/dL", "12.0-15.5", lab-flag("LOW"), "2026-05-28",),
    ("Hematocrit", "33.8", "%", "36.0-46.0", lab-flag("LOW"), "2026-05-28",),
    ("Ferritin", "11", "ng/mL", "15-150", lab-flag("LOW"), "2026-05-28",),
    ("Iron, serum", "38", "μg/dL", "50-170", lab-flag("LOW"), "2026-05-28",),
    ("Total iron binding capacity (TIBC)", "452", "μg/dL", "250-450", lab-flag("HIGH"), "2026-05-28",),
    ("TSH (thyroid stimulating hormone)", "2.41 ± 0.05", "mIU/L", "0.45-4.50", lab-flag("NORMAL"), "2026-05-28",),
    ("Free T4", "1.2", "ng/dL", "0.8-1.8", lab-flag("NORMAL"), "2026-05-28",),
    ("NT-proBNP", "118", "pg/mL", "<125", lab-flag("NORMAL"), "2026-05-28",),
    ("Troponin I, high sensitivity", "<6", "ng/L", "<12", lab-flag("NORMAL"), "2026-02-20",),
    ("Total cholesterol", "212", "mg/dL", "<200", lab-flag("HIGH"), "2026-05-28",),
    ("LDL cholesterol (calculated)", "131", "mg/dL", "<100", lab-flag("HIGH"), "2026-05-28",),
    ("HDL cholesterol", "48", "mg/dL", ">50", lab-flag("LOW"), "2026-05-28",),
    ("Triglycerides", "163", "mg/dL", "<150", lab-flag("HIGH"), "2026-05-28",),
    ("Hemoglobin A1c", "5.6", "%", "4.0-5.6", lab-flag("NORMAL"), "2026-05-28",),
    ("Glucose, fasting", "94", "mg/dL", "70-99", lab-flag("NORMAL"), "2026-05-28",),
    ("Sodium", "139", "mmol/L", "136-145", lab-flag("NORMAL"), "2026-05-28",),
    ("Potassium", "4.2", "mmol/L", "3.5-5.1", lab-flag("NORMAL"), "2026-05-28",),
    ("Creatinine", "0.78", "mg/dL", "0.57-1.00", lab-flag("NORMAL"), "2026-05-28",),
    ("eGFR (CKD-EPI 2021, non-race-based)", ">90", "mL/min/1.73m²", ">60", lab-flag("NORMAL"), "2026-05-28",),
    ("ALT", "24", "U/L", "7-35", lab-flag("NORMAL"), "2026-05-28",),
    ("AST", "21", "U/L", "10-35", lab-flag("NORMAL"), "2026-05-28",),
    ("25-hydroxyvitamin D", "34", "ng/mL", "30-100", lab-flag("NORMAL"), "2026-05-28",),
    ("C-reactive protein, high sensitivity", "1.8", "mg/L", "<3.0", lab-flag("NORMAL"), "2026-05-28",),
    ("Methylmalonic acid with reflex to homocysteine and intrinsic factor blocking antibody, serum or plasma, quantitative LC-MS/MS", "142", "nmol/L", "45-325", lab-flag("NORMAL"), "2026-05-28",),
    ("Vitamin B12", "412", "pg/mL", "232-1245", lab-flag("NORMAL"), "2026-05-28",),
  ),
)

#heading(level: 2, "Allergies & Intolerances")

#data-table(
  theme: theme,
  size: 8.5pt,
  columns: (1.1fr, 2.1fr, auto, auto,),
  align: auto,
  header: ("Substance", "Reaction", "Criticality", "Status",),
  rows: (
    ("Penicillin", "Hives and facial swelling within 1 hour of dose (childhood)", badge("high", "high"), badge("active", "active"),),
    ("Sulfa antibiotics (sulfamethoxazole)", "Diffuse maculopapular rash on day 3 of therapy", badge("low", "low"), badge("active", "active"),),
    ("Shellfish (shrimp, crab)", "Lip tingling and throat tightness; carries epinephrine auto-injector", badge("high", "high"), badge("active", "active"),),
    ("Latex", "Contact dermatitis with gloves", badge("low", "low"), badge("active", "active"),),
    ("Codeine", "Severe nausea and vomiting; reported by patient, never rechallenged", badge("unable-to-assess", "unable-to-assess"), badge("active", "active"),),
    ("Adhesive tape", "Localized blistering at ECG electrode sites", badge("low", "low"), badge("active", "active"),),
  ),
)

#heading(level: 2, "Immunizations")

#data-table(
  theme: theme,
  size: 8.5pt,
  columns: (1fr, auto, auto,),
  align: auto,
  header: ("Vaccine", "Date", "Status",),
  rows: (
    ("Influenza, seasonal (quadrivalent)", "2025-10-04", badge("completed", "completed"),),
    ("COVID-19 mRNA, 2025-2026 formulation", "2025-10-04", badge("completed", "completed"),),
    ("Tdap (tetanus, diphtheria, acellular pertussis)", "2021-08-17", badge("completed", "completed"),),
    ("Hepatitis B series (3 doses)", "2003-06-02", badge("completed", "completed"),),
    ("MMR (measles, mumps, rubella)", "1990-09-10", badge("completed", "completed"),),
    ("Varicella series", "1996-04-15", badge("completed", "completed"),),
    ("HPV (9-valent, 3 doses)", "2007-11-20", badge("completed", "completed"),),
    ("Hepatitis A series (2 doses)", "2018-03-22", badge("completed", "completed"),),
  ),
)

#heading(level: 2, "Recent Cardiology-Relevant Encounters and Diagnostics")

#data-table(
  theme: theme,
  size: 6.5pt,
  columns: (0.78fr, 0.95fr, 1fr, 1fr, 1.15fr, 1.15fr, 1.1fr, 1.15fr, 1.1fr,),
  align: auto,
  header: ("Encounter date and time", "Encounter type and setting", "Performing or attending clinician", "Chief complaint as documented", "Key findings and measurements recorded", "Diagnostic studies ordered or performed", "Resulting clinical impression", "Follow-up plan and disposition", "Patient-reported outcome notes",),
  rows: (
    ("2026-02-20 14:35", "Urgent care, walk-in (Eastside Clinic)", "Dr. Samuel Whitfield, urgent care attending", "Racing heart and lightheadedness after climbing one flight of stairs", "HR 118 on arrival, declining to 84 over 40 minutes; BP 142/91; SpO2 99% on room air", "12-lead ECG (normal sinus rhythm, no ST changes); high-sensitivity troponin x1 (<6 ng/L)", "Symptomatic palpitations, resolved in clinic; no acute coronary findings", "Referral placed to primary care within 1 week; return precautions given for syncope or chest pain", "Patient reported episode felt identical to prior events; rated fear 8/10, symptoms 5/10",),
    ("2026-03-02 09:00", "Primary care office visit (Lakeview Family Medicine)", "Dr. Priya Raman, internal medicine", "Follow-up of urgent care visit for recurrent palpitations", "BP 138/88; HR 76 regular; BMI 29.4; trace bilateral ankle edema noted", "48-hour Holter monitor ordered; basic metabolic panel; TSH; CBC", "Probable paroxysmal SVT vs. inappropriate sinus tachycardia; beta-blocker trial initiated", "Started metoprolol succinate 25 mg daily; cardiology referral placed; sleep study discussed", "Patient using smartwatch ECG; instructed to export and bring recordings to all visits",),
    ("2026-03-18 11:20", "Ambulatory diagnostics (Holter monitor return and scan)", "Reviewed by Dr. Priya Raman with cardiology overread by Dr. Elena Marsh", "Device return after 48-hour ambulatory rhythm monitoring", "Two symptomatic episodes captured in diary; longest run 7 minutes at 161 bpm", "48-hour Holter: narrow-complex tachycardia with abrupt onset/offset during both diary-flagged episodes", "Findings consistent with paroxysmal supraventricular tachycardia", "Expedited cardiology consult requested; patient counseled on vagal maneuvers pending visit", "Patient relieved that ‘something finally showed up on a test’; anxiety notably reduced",),
    ("2026-04-29 16:05", "Telehealth visit (Lakeview Family Medicine, video)", "Dr. Priya Raman, internal medicine", "Medication tolerance check and pre-cardiology review", "Home BP log average 131/84 over 14 days; HR average 68; episodes reduced from 3/week to 1/week", "None this visit; prior labs reviewed including iron studies showing deficiency", "Partial response to metoprolol; iron deficiency anemia may be aggravating tachycardia", "Ferrous sulfate adjusted to every-other-day dosing; cardiology visit confirmed for 2026-06-12", "Patient reports more confidence climbing stairs but still avoids carrying laundry alone",),
    ("2026-05-28 08:15", "Outpatient laboratory draw (Eastside Clinic lab)", "Standing orders of Dr. Priya Raman; results released to portal same day", "Pre-visit laboratory panel ahead of cardiology consultation", "Fasting draw completed without complication; patient tolerated well", "CBC, CMP, lipid panel, TSH with free T4, iron studies, NT-proBNP, hs-CRP, B12, MMA", "Persistent iron deficiency anemia (Hgb 10.9, ferritin 11); lipids above goal; cardiac markers reassuring", "All results forwarded to Dr. Elena Marsh, cardiology, for 2026-06-12 consultation", "Patient reviewed every result in portal and prepared a written question list for cardiology",),
  ),
)
