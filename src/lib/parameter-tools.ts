// Provider API index: https://api-nextgen-tools.iedb.org/apidocs
// Reviewed 2026-09-30. These GET routes inspect parameters; they do not run jobs.
export const parameterTools = [
  ["bcell_structure", "B-cell structure predictions (DiscoTope / ElliPro)"],
  ["bcell_sequence", "B-cell sequence predictions"],
  ["mhci", "MHC class I binding, processing and immunogenicity"],
  ["mhcii", "MHC class II predictions"],
  ["cluster", "Peptide clustering"],
  ["pepmatch", "Peptide matching"],
  ["pepx", "Peptide expression annotation"],
  ["pepcomp", "Peptide variant comparison"],
  ["mutgen", "Mutated peptide generation"],
  ["phbr", "Patient harmonic-mean best rank"],
] as const;
