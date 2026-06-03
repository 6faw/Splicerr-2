import { querySplice } from "./api"

const SoundsSearchAutocomplete = {
    operationName: "SoundsSearchAutocomplete",
    variables: { term: "" },
    query: 'query SoundsSearchAutocomplete($term: String!) {\n  soundsSearchSuggestions(searchTerm: $term, limit: 7, context: "marketplace") {\n    autocompleteUuid\n    results {\n      autocompleteTerm\n      termType\n      length\n      offset\n      __typename\n    }\n    __typename\n  }\n}',
}

export function searchAutocomplete(term: string) {
    return querySplice(SoundsSearchAutocomplete, { term })
}
