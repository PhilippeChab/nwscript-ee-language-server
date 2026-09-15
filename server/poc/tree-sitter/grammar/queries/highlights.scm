(comment) @comment
[(primitive_type) (nwn_type)] @type.builtin
[(string_literal) (raw_string_literal) (hashed_string_literal) (raw_string_content) (string_content) (string_start) (hashed_string_start)] @string
(number_literal) @number
(function_definition declarator: (identifier) @function)
(call_expression function: (identifier) @function)
(parameter_declaration declarator: (identifier) @variable.parameter)
(struct_declarator declarator: (identifier) @type)
(struct_specifier (identifier) @type)
(field_identifier) @property
