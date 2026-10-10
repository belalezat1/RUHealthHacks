Sevaro | Rutgers Health Hack | Developer Kit

Pick one challenge. Each folder has the challenge brief (start here) and its synthetic data.

Challenge_1_Guided_Workflow/
  Sevaro_Rutgers_Health_Hack_Challenge_1_Guided_Workflow.pdf   Brief, hospital guides, validation examples
  data/hospital_guides.json             Seven synthetic hospital guides, one record per field
  data/storyboard_notes.json            Second source that can disagree with the guides
  data/caselog_field_map.csv            Caselog steps, fields and nudge triggers
  data/encounter_context_example.json   The context object your system receives
  data/validation_set.csv               Questions V01-V20 with expected answers
  data/nudge_scenarios.json             Scenarios N1-N9 with expected nudges

Challenge_2_Ops_Command_Center/
  Sevaro_Rutgers_Health_Hack_Challenge_2_Operations_Command_Center.pdf   Brief, rules, dataset description
  data/event_stream.csv                 Source of truth: events 07:00-18:20 ET
  data/hospitals.csv                    12 hospitals, time zones, coverage tier
  data/physicians_on_shift.csv          8 on-shift physicians
  data/physicians_off_shift_roster.csv  6 off-shift physicians
  data/credentialing_matrix.csv         Who can take consults from which hospital
  data/baseline_hourly_volume.csv       Normal demand per hospital per hour
  data/coverage_requirements.csv        Minimum coverage per hospital per time block
  data/snapshot_*_1820.csv              Reference state at 18:20; your replay should match it

During judging, your system will be given new data it has not seen, in the same formats as above.
Be ready to load a new file while your screen is shared, without restarting.

Everything in this kit is synthetic. No patient data, real hospital protocols, or production access
is included or needed. This content is for hackathon prototyping only and is not clinical guidance.
