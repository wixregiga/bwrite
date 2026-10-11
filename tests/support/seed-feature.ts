// The Feature a first visit opens, as an author sees it in the editor.
export const SEED_GHERKIN = `Feature: Inspect domain vocabulary while authoring
  Scenario: Inspect an accepted Domain Term
    Given a Feature contains an accepted Domain Term
    When the author inspects the Domain Term
    Then its definition is displayed
    And the author can open the term details`;
