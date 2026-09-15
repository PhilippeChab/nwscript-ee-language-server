const PREC = {
    PAREN_DECLARATOR: -10,
    ASSIGNMENT: -1,
    CONDITIONAL: -2,
    DEFAULT: 0,
    LOGICAL_OR: 1,
    LOGICAL_AND: 2,
    INCLUSIVE_OR: 3,
    EXCLUSIVE_OR: 4,
    BITWISE_AND: 5,
    EQUAL: 6,
    RELATIONAL: 7,
    SIZEOF: 8,
    SHIFT: 9,
    ADD: 10,
    MULTIPLY: 11,
    CAST: 12,
    UNARY: 13,
    CALL: 14,
    FIELD: 15,
    SUBSCRIPT: 16
};

module.exports = grammar({
    name: 'nwscript',

    extras: $ => [
        /\s|\\\r?\n/,
        $.comment,
    ],

    inline: $ => [
        $._statement,
        $._top_level_item,
        $._type_identifier,
        $._field_identifier,
        $._statement_identifier,
        $._non_case_statement,
        $._assignment_left_expression
    ],

    conflicts: $ => [
        [$._type_specifier, $._declarator],
        [$._type_specifier, $._expression],
    ],

    word: $ => $.identifier,

    rules: {
        translation_unit: $ => repeat($._top_level_item),

        _top_level_item: $ => choice(
            $.declaration,
            $.decoration,
            $._statement,
            $.struct_declarator,
            $.preproc_if,
            $.preproc_ifdef,
            $.preproc_include,
            $.preproc_def,
            $.preproc_function_def,
            $.preproc_call,
            $.nwnsc_macro,
            $.function_definition
        ),

        // Preprocesser

        preproc_include: $ => seq(
            preprocessor('include'),
            field('file', $.string_literal),
            '\n'
        ),

        preproc_def: $ => seq(
            preprocessor('define'),
            field('name', $.identifier),
            field('value', optional($.preproc_arg)),
            '\n'
        ),

        preproc_function_def: $ => seq(
            preprocessor('define'),
            field('name', $.identifier),
            field('parameters', $.preproc_params),
            field('value', optional($.preproc_arg)),
            '\n'
        ),

        preproc_params: $ => seq(
            token.immediate('('), commaSep(choice($.identifier, '...')), ')'
        ),

        preproc_call: $ => seq(
            field('directive', $.preproc_directive),
            field('argument', optional($.preproc_arg)),
            '\n'
        ),

        ...preprocIf('', $ => $._top_level_item),
        ...preprocIf('_in_field_declaration_list', $ => $._field_declaration_list_item),

        preproc_directive: $ => /#[ \t]*[a-zA-Z]\w*/,
        preproc_arg: $ => token(prec(-1, repeat1(/.|\\\r?\n/))),

        _preproc_expression: $ => choice(
            $.identifier,
            alias($.preproc_call_expression, $.call_expression),
            $.number_literal,
            $.preproc_defined,
            alias($.preproc_unary_expression, $.unary_expression),
            alias($.preproc_binary_expression, $.binary_expression),
            alias($.preproc_parenthesized_expression, $.parenthesized_expression)
        ),

        preproc_parenthesized_expression: $ => seq(
            '(',
            $._preproc_expression,
            ')'
        ),

        preproc_defined: $ => choice(
            prec(PREC.CALL, seq('defined', '(', $.identifier, ')')),
            seq('defined', $.identifier),
        ),

        preproc_unary_expression: $ => prec.left(PREC.UNARY, seq(
            field('operator', choice('!', '~', '-', '+')),
            field('argument', $._preproc_expression)
        )),

        preproc_call_expression: $ => prec(PREC.CALL, seq(
            field('function', $.identifier),
            field('arguments', alias($.preproc_argument_list, $.argument_list))
        )),

        preproc_argument_list: $ => seq(
            '(',
            commaSep($._preproc_expression),
            ')'
        ),

        preproc_binary_expression: $ => {
            const table = [
                ['+', PREC.ADD],
                ['-', PREC.ADD],
                ['*', PREC.MULTIPLY],
                ['/', PREC.MULTIPLY],
                ['%', PREC.MULTIPLY],
                ['||', PREC.LOGICAL_OR],
                ['&&', PREC.LOGICAL_AND],
                ['|', PREC.INCLUSIVE_OR],
                ['^', PREC.EXCLUSIVE_OR],
                ['&', PREC.BITWISE_AND],
                ['==', PREC.EQUAL],
                ['!=', PREC.EQUAL],
                ['>', PREC.RELATIONAL],
                ['>=', PREC.RELATIONAL],
                ['<=', PREC.RELATIONAL],
                ['<', PREC.RELATIONAL],
                ['<<', PREC.SHIFT],
                ['>>', PREC.SHIFT],
            ];

            return choice(...table.map(([operator, precedence]) => {
                return prec.left(precedence, seq(
                    field('left', $._preproc_expression),
                    field('operator', operator),
                    field('right', $._preproc_expression)
                ))
            }));
        },

        // Main Grammar

        function_definition: $ => seq(
            $._declaration_specifiers,
            field('declarator', $._declarator),
            $.function_argument_list,
            choice(';',
                field('body', $.compound_statement)
            )),

        function_argument_list: $ => seq('(', commaSep($.parameter_declaration), ')'),

        declaration: $ => seq(
            $._declaration_specifiers,
            commaSep1(field('declarator', choice(
                $._declarator,
                $.init_declarator
            ))),
            ';'
        ),

        _declaration_specifiers: $ => seq(
            optional(
                $.const_qualifier
            ),
            field('type', $._type_specifier),
        ),

        declaration_list: $ => seq(
            '{',
            repeat($._top_level_item),
            '}'
        ),

        _declarator: $ => choice(
            $.parenthesized_declarator,
            $.identifier
        ),

        _field_declarator: $ => choice(
            alias($.parenthesized_field_declarator, $.parenthesized_declarator),
            $._field_identifier
        ),

        _type_declarator: $ => choice(
            alias($.parenthesized_type_declarator, $.parenthesized_declarator),
            $._type_identifier
        ),

        parenthesized_declarator: $ => prec.dynamic(PREC.PAREN_DECLARATOR, seq(
            '(',
            $._declarator,
            ')'
        )),
        parenthesized_field_declarator: $ => prec.dynamic(PREC.PAREN_DECLARATOR, seq(
            '(',
            $._field_declarator,
            ')'
        )),
        parenthesized_type_declarator: $ => prec.dynamic(PREC.PAREN_DECLARATOR, seq(
            '(',
            $._type_declarator,
            ')'
        )),

        function_field_declarator: $ => prec(1, seq(
            field('declarator', $._field_declarator),
            field('parameters', $.parameter_list)
        )),
        function_type_declarator: $ => prec(1, seq(
            field('declarator', $._type_declarator),
            field('parameters', $.parameter_list)
        )),

        init_declarator: $ => seq(
            field('declarator', $._declarator),
            '=',
            field('value', choice($.initializer_list, $._expression))
        ),

        compound_statement: $ => seq(
            '{',
            repeat($._top_level_item),
            '}'
        ),

        const_qualifier: $ => token('const'),

        _type_specifier: $ => choice(
            $.struct_specifier,
            $._return_specifier,
            $._type_identifier
        ),

        _return_specifier: $ => prec(1, choice(
            $.primitive_type,
            $.nwn_type
        )),

        primitive_type: $ => token(choice(
            'int',
            'float',
            'void',
            'string'
        )),

        nwn_type: $ => token(choice(
            'object',
            'vector',
            'location',
            'sqlquery',
            'effect',
            'itemproperty',
            'event',
            'talent',
            'cassowary',
            'json',
            'action'
        )),

        nwnsc_macro: $ => token(prec(2,
            seq(
                '__',
                choice(
                    'FILE',
                    'LINE',
                    'COUNTER',
                    'FUNCTION',
                    'NSC_COMPILER_DATE',
                    'NSC_COMPILER_TIME'),
                '__'
            )
        )),

        struct_declarator: $ => seq(
            'struct',
            field('declarator', $.identifier),
            $.struct_members,
            ';'
        ),

        struct_members: $ => seq(
            '{',
            repeat($.field_declaration),
            '}',
        ),

        struct_specifier: $ => seq(
            'struct',
            $.identifier
        ),

        vector_specifier: $ => seq(
            '[',
            $.number_literal, ',',
            $.number_literal, ',',
            $.number_literal,
            ']'
        ),

        field_declaration_list: $ => seq(
            '{',
            repeat($._field_declaration_list_item),
            '}'
        ),

        _field_declaration_list_item: $ => choice(
            $.field_declaration,
            $.preproc_def,
            $.preproc_function_def,
            $.preproc_call,
            alias($.preproc_if_in_field_declaration_list, $.preproc_if),
            alias($.preproc_ifdef_in_field_declaration_list, $.preproc_ifdef),
        ),

        field_declaration: $ => seq(
            $._declaration_specifiers,
            commaSep(field('declarator', $._field_declarator)),
            optional($.bitfield_clause),
            ';'
        ),

        bitfield_clause: $ => seq(':', $._expression),

        enumerator: $ => seq(
            field('name', $.identifier),
            optional(seq('=', field('value', $._expression)))
        ),

        parameter_list: $ => seq(
            '(',
            commaSep(choice($.parameter_declaration, '...')),
            ')'
        ),

        parameter_declaration: $ => seq(
            $._declaration_specifiers,
            optional(field('declarator',
                $._declarator,
            )),
            optional(seq('=', field('default', $._expression)))
        ),

        // Statements

        _statement: $ => choice(
            $.case_statement,
            $._non_case_statement
        ),

        _non_case_statement: $ => choice(
            $.compound_statement,
            $.expression_statement,
            $.if_statement,
            $.switch_statement,
            $.do_statement,
            $.while_statement,
            $.for_statement,
            $.return_statement,
            $.break_statement,
            $.continue_statement,
        ),

        expression_statement: $ => seq(
            optional(choice(
                $._expression,
                $.comma_expression
            )),
            ';'
        ),

        if_statement: $ => prec.right(seq(
            'if',
            field('condition', $.parenthesized_expression),
            field('consequence', $._statement),
            optional(seq(
                'else',
                field('alternative', $._statement)
            ))
        )),

        switch_statement: $ => seq(
            'switch',
            field('condition', $.parenthesized_expression),
            field('body', $.compound_statement)
        ),

        case_statement: $ => prec.right(seq(
            choice(
                seq('case', field('value', $._expression)),
                'default'
            ),
            ':',
            repeat(choice(
                $._non_case_statement,
                $.declaration
            ))
        )),

        while_statement: $ => seq(
            'while',
            field('condition', $.parenthesized_expression),
            field('body', $._statement)
        ),

        do_statement: $ => seq(
            'do',
            field('body', $._statement),
            'while',
            field('condition', $.parenthesized_expression),
            ';'
        ),

        for_statement: $ => seq(
            'for',
            '(',
            choice(field('initializer', $.declaration), seq(field('initializer', optional(choice($._expression, $.comma_expression))), ';')),
            field('condition', optional($._expression)), ';',
            field('update', optional(choice($._expression, $.comma_expression))),
            ')',
            $._statement
        ),

        return_statement: $ => seq(
            'return',
            optional(choice($._expression, $.comma_expression)),
            ';'
        ),

        break_statement: $ => seq(
            'break', ';'
        ),

        continue_statement: $ => seq(
            'continue', ';'
        ),

        // Expressions

        _expression: $ => choice(
            $.conditional_expression,
            $.assignment_expression,
            $.binary_expression,
            $.unary_expression,
            $.update_expression,
            $.call_expression,
            $.field_expression,
            $.compound_literal_expression,
            $.nwn_constant,
            $.identifier,
            $.number_literal,
            $.string_literal,
            $.raw_string_literal,
            $.hashed_string_literal,
            $.concatenated_string,
            $.parenthesized_expression,
            $.vector_specifier,
        ),

        comma_expression: $ => seq(
            field('left', $._expression),
            ',',
            field('right', choice($._expression, $.comma_expression))
        ),

        conditional_expression: $ => prec.right(PREC.CONDITIONAL, seq(
            field('condition', $._expression),
            '?',
            field('consequence', $._expression),
            ':',
            field('alternative', $._expression)
        )),

        _assignment_left_expression: $ => choice(
            $.identifier,
            $.call_expression,
            $.field_expression,
            $.parenthesized_expression
        ),

        assignment_expression: $ => prec.right(PREC.ASSIGNMENT, seq(
            field('left', $._assignment_left_expression),
            field('operator', choice(
                '=',
                '*=',
                '/=',
                '%=',
                '+=',
                '-=',
                '<<=',
                '>>=',
                '&=',
                '^=',
                '|=',
                '>>>='
            )),
            field('right', $._expression)
        )),

        unary_expression: $ => prec.left(PREC.UNARY, seq(
            field('operator', choice('!', '~', '-', '+')),
            field('argument', $._expression)
        )),

        binary_expression: $ => {
            const table = [
                ['+', PREC.ADD],
                ['-', PREC.ADD],
                ['*', PREC.MULTIPLY],
                ['/', PREC.MULTIPLY],
                ['%', PREC.MULTIPLY],
                ['||', PREC.LOGICAL_OR],
                ['&&', PREC.LOGICAL_AND],
                ['|', PREC.INCLUSIVE_OR],
                ['^', PREC.EXCLUSIVE_OR],
                ['&', PREC.BITWISE_AND],
                ['==', PREC.EQUAL],
                ['!=', PREC.EQUAL],
                ['>', PREC.RELATIONAL],
                ['>=', PREC.RELATIONAL],
                ['<=', PREC.RELATIONAL],
                ['<', PREC.RELATIONAL],
                ['<<', PREC.SHIFT],
                ['>>', PREC.SHIFT],
                ['>>>', PREC.SHIFT],
            ];

            return choice(...table.map(([operator, precedence]) => {
                return prec.left(precedence, seq(
                    field('left', $._expression),
                    field('operator', operator),
                    field('right', $._expression)
                ))
            }));
        },

        update_expression: $ => {
            const argument = field('argument', $._expression);
            const operator = field('operator', choice('--', '++'));
            return prec.right(PREC.UNARY, choice(
                seq(operator, argument),
                seq(argument, operator),
            ));
        },

        type_descriptor: $ => seq(
            optional($.const_qualifier),
            field('type', $._type_specifier),
        ),

        call_expression: $ => prec(PREC.CALL, seq(
            field('function', $._expression),
            field('arguments', $.argument_list)
        )),

        argument_list: $ => seq('(', commaSep($._expression), ')'),

        field_expression: $ => seq(
            prec(PREC.FIELD, seq(
                field('argument', $._expression),
                field('operator', '.')
            )),
            field('field', $._field_identifier)
        ),

        compound_literal_expression: $ => seq(
            '(',
            field('type', $.type_descriptor),
            ')',
            field('value', $.initializer_list)
        ),

        parenthesized_expression: $ => seq(
            '(',
            choice($._expression, $.comma_expression),
            ')'
        ),

        initializer_list: $ => seq(
            '{',
            commaSep(choice(
                $.initializer_pair,
                $._expression,
                $.initializer_list
            )),
            optional(','),
            '}'
        ),

        initializer_pair: $ => seq(
            field('designator', repeat1($.field_designator)),
            '=',
            field('value', choice($._expression, $.initializer_list))
        ),

        field_designator: $ => seq('.', $._field_identifier),

        number_literal: $ => {
            const separator = "'";
            const hex = /[0-9a-fA-F]/;
            const decimal = /[0-9]/;
            const hexDigits = seq(repeat1(hex), repeat(seq(separator, repeat1(hex))));
            const decimalDigits = seq(repeat1(decimal), repeat(seq(separator, repeat1(decimal))));
            return token(seq(
                optional(/[-\+]/),
                optional(choice('0x', '0b')),
                choice(
                    seq(
                        choice(
                            decimalDigits,
                            seq('0b', decimalDigits),
                            seq('0o', /[0-7]+/),
                            seq('0x', hexDigits)
                        ),
                        optional(seq('.', optional(hexDigits)))
                    ),
                    seq('.', decimalDigits)
                ),
                optional(seq(
                    /[eEpP]/,
                    optional(seq(
                        optional(/[-\+]/),
                        hexDigits
                    ))
                )),
                repeat(choice('u', 'l', 'U', 'L', 'f', 'F'))
            ))
        },

        concatenated_string: $ => seq(
            $.string_literal,
            repeat1($.string_literal)
        ),

        raw_string_literal: $ => seq(
            $.raw_string_start,
            repeat(choice($.raw_string_content, $.raw_string_escape)),
            token.immediate('"')
        ),

        raw_string_start: $ => token(/[rR]"/),
        raw_string_content: $ => token.immediate(/[^"\x00]+/),
        raw_string_escape: $ => token.immediate('""'),

        hashed_string_literal: $ => seq(
            $.hashed_string_start,
            repeat(choice($.string_content, $.escape_sequence)),
            token.immediate('"')
        ),

        string_start: $ => token('"'),
        string_content: $ => token.immediate(prec(1, /[^\\"\n]+/)),
        hashed_string_start: $ => token(/[hH]"/),

        string_literal: $ => seq(
            $.string_start,
            repeat(choice(
                $.string_content,
                $.escape_sequence
            )),
            '"',
        ),

        escape_sequence: $ => token(prec(1, seq(
            '\\',
            choice(
                /[^xuU]/,
                /\d{2,3}/,
                /x[0-9a-fA-F]{2,}/,
                /u[0-9a-fA-F]{4}/,
                /U[0-9a-fA-F]{8}/
            )
        ))),

        nwn_constant: $ => prec(1, choice(
            $.true,
            $.false,
            $.object_self,
            $.object_invalid
        )),

        true: $ => token('TRUE'),
        false: $ => token('FALSE'),
        object_self: $ => token('OBJECT_SELF'),
        object_invalid: $ => token('OBJECT_INVALID'),

        local_const: $ => prec(5, /[A-Z0-9_]/),
        identifier: $ => /[a-zA-Z_]\w*/,

        _type_identifier: $ => alias($.identifier, $.type_identifier),
        _field_identifier: $ => alias($.identifier, $.field_identifier),
        _statement_identifier: $ => alias($.identifier, $.statement_identifier),

        //decoration: $ => token(/\/\/([\s]*@[\s]*[a-zA-Z_]\w*[\s]*\[?[a-zA-Z_]\w*[\s]*:?[\s]*[a-zA-Z_]\w*\]?)/gm),
        //decoration: $ => token(seq('//', /([\s]*@[\s\S]*)/gm)),
        decoration: $ => token(/(\/\/\s*@(\\(.|\r?\n)|[^\\\n])*)/),
        // http://stackoverflow.com/questions/13014947/regex-to-match-a-c-style-multiline-comment/36328890#36328890

        // TODO: refactor this
        comment: $ => token(choice(
            seq('//', /(\\(.|\r?\n)|[^\\\n])*/),
            seq(
                '/*',
                /[^*]*\*+([^/*][^*]*\*+)*/,
                '/'
            ),
            prec(-1, seq(
                '/*',
                /([^╫]+)/
            )),
        )),
    },

    supertypes: $ => [
        $._expression,
        $._statement,
        $._type_specifier,
        $._declarator,
        $._field_declarator,
        $._type_declarator
    ]
});

module.exports.PREC = PREC

function preprocIf(suffix, content) {
    function elseBlock($) {
        return choice(
            suffix ? alias($['preproc_else' + suffix], $.preproc_else) : $.preproc_else,
            suffix ? alias($['preproc_elif' + suffix], $.preproc_elif) : $.preproc_elif,
        );
    }

    return {
        ['preproc_if' + suffix]: $ => seq(
            preprocessor('if'),
            field('condition', $._preproc_expression),
            '\n',
            repeat(content($)),
            field('alternative', optional(elseBlock($))),
            preprocessor('endif')
        ),

        ['preproc_ifdef' + suffix]: $ => seq(
            choice(preprocessor('ifdef'), preprocessor('ifndef')),
            field('name', $.identifier),
            repeat(content($)),
            field('alternative', optional(elseBlock($))),
            preprocessor('endif')
        ),

        ['preproc_else' + suffix]: $ => seq(
            preprocessor('else'),
            repeat(content($))
        ),

        ['preproc_elif' + suffix]: $ => seq(
            preprocessor('elif'),
            field('condition', $._preproc_expression),
            '\n',
            repeat(content($)),
            field('alternative', optional(elseBlock($))),
        )
    }
}

function preprocessor(command) {
    return alias(new RegExp('#[ \t]*' + command), '#' + command)
}

function commaSep(rule) {
    return optional(commaSep1(rule))
}

function commaSep1(rule) {
    return seq(rule, repeat(seq(',', rule)))
}

function commaSepTrailing(recurSymbol, rule) {
    return choice(rule, seq(recurSymbol, ',', rule))
}