// Derived from nwn-rs/tree-sitter-nwscript; see LICENSE.txt and ../README.md.
const PREC = {
    ASSIGNMENT: 1, CONDITIONAL: 2, LOGICAL_OR: 3, LOGICAL_AND: 4,
    BITWISE_OR: 5, BITWISE_XOR: 6, BITWISE_AND: 7, EQUAL: 8,
    RELATIONAL: 9, SHIFT: 10, ADD: 11, MULTIPLY: 12, UNARY: 13,
    CALL: 14, FIELD: 15,
};

module.exports = grammar({
    name: 'nwscript',
    extras: $ => [/\s|\\\r?\n/, $.comment],
    word: $ => $.identifier,
    reserved: {
        global: $ => [$.primitive_type, $.void_type, $.nwn_type, 'struct', 'const',
            'if', 'else', 'while', 'for', 'return', 'break', 'continue', 'switch', 'case', 'default', 'do'],
    },
    rules: {
        translation_unit: $ => repeat(choice(
            $.declaration, $.struct_declarator, $.function_definition,
            $.preproc_include, $.preproc_def,
            // Retain lexical context for expressions being typed at file scope.
            $.expression_statement,
        )),

        preproc_include: $ => seq(alias(/#[ \t]*include/, '#include'), field('file', $.string_literal)),
        // ENGINE_* definitions are used by the engine API specification. Their
        // validity in a particular compilation context belongs to the compiler.
        preproc_def: $ => seq(alias(/#[ \t]*define/, '#define'),
            field('name', alias(token(choice('ENGINE_NUM_STRUCTURES', /ENGINE_STRUCTURE_[0-9]+/)), $.identifier)), field('value', $.preproc_arg)),
        preproc_arg: $ => token(prec(-1, /[^\r\n]+/)),

        function_definition: $ => seq(
            choice(field('type', $.void_type), $._declaration_specifiers),
            field('declarator', $.identifier), $.function_argument_list,
            choice(';', field('body', $.compound_statement)),
        ),
        function_argument_list: $ => seq('(', commaSep($.parameter_declaration), ')'),
        parameter_declaration: $ => seq(
            $._declaration_specifiers, field('declarator', $.identifier),
            optional(seq('=', field('default', $._expression))),
        ),
        declaration: $ => seq($._declaration_specifiers,
            commaSep1(field('declarator', choice($.identifier, $.init_declarator))), ';'),
        _declaration_specifiers: $ => seq(optional($.const_qualifier), field('type', $._type_specifier)),
        init_declarator: $ => seq(field('declarator', $.identifier), '=', field('value', $._expression)),
        const_qualifier: $ => 'const',
        _type_specifier: $ => choice($.primitive_type, $.nwn_type, $.struct_specifier),
        primitive_type: $ => token(choice('int', 'float', 'string')),
        void_type: $ => 'void',
        nwn_type: $ => token(choice('object', 'vector', 'location', 'sqlquery', 'effect',
            'itemproperty', 'event', 'talent', 'cassowary', 'json', 'action')),
        struct_specifier: $ => seq('struct', $.identifier),
        struct_declarator: $ => seq('struct', field('declarator', $.identifier), $.struct_members, ';'),
        struct_members: $ => seq('{', repeat($.field_declaration), '}'),
        field_declaration: $ => seq($._declaration_specifiers,
            commaSep1(field('declarator', alias($.identifier, $.field_identifier))), ';'),

        compound_statement: $ => seq('{', repeat(choice($.declaration, $._statement)), '}'),
        _statement: $ => choice($.compound_statement, $.expression_statement,
            $.if_statement, $.switch_statement, $.case_statement, $.while_statement,
            $.do_statement, $.for_statement, $.return_statement, $.break_statement, $.continue_statement),
        expression_statement: $ => seq(optional($._expression), ';'),
        if_statement: $ => prec.right(seq('if', field('condition', $.parenthesized_expression),
            field('consequence', $._statement), optional(seq('else', field('alternative', $._statement))))),
        switch_statement: $ => seq('switch', field('condition', $.parenthesized_expression), field('body', $.compound_statement)),
        case_statement: $ => seq(choice(seq('case', field('value', $._expression)), 'default'), ':'),
        while_statement: $ => seq('while', field('condition', $.parenthesized_expression), field('body', $._statement)),
        do_statement: $ => seq('do', field('body', $._statement), 'while', field('condition', $.parenthesized_expression), ';'),
        for_statement: $ => seq('for', '(', field('initializer', optional($._expression)), ';',
            field('condition', optional($._expression)), ';', field('update', optional($._expression)), ')', field('body', $._statement)),
        return_statement: $ => seq('return', optional($._expression), ';'),
        break_statement: $ => seq('break', ';'),
        continue_statement: $ => seq('continue', ';'),

        _expression: $ => choice($.assignment_expression, $._non_assignment_expression),
        _non_assignment_expression: $ => choice($.conditional_expression, $.binary_expression,
            $.unary_expression, $.update_expression, $.call_expression, $.field_expression,
            $.identifier, $.number_literal, $.string_literal, $.raw_string_literal,
            $.hashed_string_literal, $.parenthesized_expression, $.vector_specifier),
        conditional_expression: $ => prec.right(PREC.CONDITIONAL, seq(field('condition', $._non_assignment_expression), '?',
            field('consequence', $._non_assignment_expression), ':', field('alternative', $._non_assignment_expression))),
        assignment_expression: $ => prec.right(PREC.ASSIGNMENT, seq(
            field('left', $._non_assignment_expression),
            field('operator', choice('=', '*=', '/=', '%=', '+=', '-=', '<<=', '>>=', '&=', '^=', '|=', '>>>=')),
            field('right', $._non_assignment_expression))),
        unary_expression: $ => prec.left(PREC.UNARY, seq(field('operator', choice('!', '~', '-', '+')), field('argument', $._non_assignment_expression))),
        binary_expression: $ => choice(...[
            ['+', PREC.ADD], ['-', PREC.ADD], ['*', PREC.MULTIPLY], ['/', PREC.MULTIPLY], ['%', PREC.MULTIPLY],
            ['||', PREC.LOGICAL_OR], ['&&', PREC.LOGICAL_AND], ['|', PREC.BITWISE_OR], ['^', PREC.BITWISE_XOR], ['&', PREC.BITWISE_AND],
            ['==', PREC.EQUAL], ['!=', PREC.EQUAL], ['>', PREC.RELATIONAL], ['>=', PREC.RELATIONAL], ['<=', PREC.RELATIONAL], ['<', PREC.RELATIONAL],
            ['<<', PREC.SHIFT], ['>>', PREC.SHIFT], ['>>>', PREC.SHIFT],
        ].map(([operator, precedence]) => prec.left(precedence, seq(field('left', $._non_assignment_expression), field('operator', operator), field('right', $._non_assignment_expression))))),
        update_expression: $ => prec.right(PREC.UNARY, choice(
            seq(field('operator', choice('--', '++')), field('argument', $._non_assignment_expression)),
            seq(field('argument', $._non_assignment_expression), field('operator', choice('--', '++'))),
        )),
        call_expression: $ => prec(PREC.CALL, seq(field('function', $.identifier), field('arguments', $.argument_list))),
        argument_list: $ => seq('(', commaSep($._expression), ')'),
        field_expression: $ => prec.left(PREC.FIELD, seq(field('argument', $._non_assignment_expression), '.', field('field', alias($.identifier, $.field_identifier)))),
        parenthesized_expression: $ => seq('(', $._expression, ')'),
        // Missing trailing components default to zero in the native compiler.
        vector_specifier: $ => seq('[', optional(seq($._vector_component,
            optional(seq(',', $._vector_component, optional(seq(',', $._vector_component)))))), ']'),
        _vector_component: $ => choice($.number_literal, $.identifier),
        // The native lexer accepts empty radix prefixes as zero. Signs are
        // operators, not part of numeric tokens. It has no exponent notation.
        number_literal: $ => token(choice(/0[xX][0-9a-fA-F]*/, /0[bB][01]*/, /0[oO][0-7]*/,
            /[0-9]+(\.[0-9]*)?f?/, /\.[0-9]+f?/)),

        raw_string_literal: $ => seq($.raw_string_start, repeat(choice($.raw_string_content, $.raw_string_escape)), token.immediate('"')),
        raw_string_start: $ => token(/[rR]"/),
        raw_string_content: $ => token.immediate(/[^"\x00]+/),
        raw_string_escape: $ => token.immediate('""'),
        string_literal: $ => seq($.string_start, repeat(choice($.string_content, $.escape_sequence)), token.immediate('"')),
        hashed_string_literal: $ => seq($.hashed_string_start, repeat(choice($.string_content, $.escape_sequence)), token.immediate('"')),
        string_start: $ => token('"'),
        hashed_string_start: $ => token(/[hH]"/),
        string_content: $ => token.immediate(/[^\\"\r\n]+/),
        // Unknown escapes are accepted by the native lexer. Newlines are not.
        escape_sequence: $ => token.immediate(seq('\\', /[^\r\n]/)),
        identifier: $ => /[a-zA-Z_][a-zA-Z_0-9]*/,
        comment: $ => token(choice(seq('//', /[^\r\n]*/), seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
            seq('/*', /([^*]|\*+[^/*])*\**/))),
    },
});

function commaSep(rule) { return optional(commaSep1(rule)); }
function commaSep1(rule) { return seq(rule, repeat(seq(',', rule))); }
