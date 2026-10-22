"""Hand-authored byte fixtures for the independent, bounded AVM1 test runner."""
import importlib
import math
import unittest


class VMTests(unittest.TestCase):
    def vm_module(self):
        try:
            module = importlib.import_module('avm1_vm')
        except ModuleNotFoundError:
            module = None
        self.assertIsNotNone(module, 'independent AVM1 evaluator is not implemented')
        return module

    def test_add2_preserves_string_concatenation(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('9608000032000703000000473e'))
        self.assertEqual(vm.result, '23')

    def test_init_array_pops_values_in_avm1_order(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('960f00070100000007020000000702000000423e'))
        self.assertEqual(vm.result, [2, 1])

    def test_call_function_reverses_argument_push_order(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('9612000709000000070400000007020000000066003d3e'),
                            variables={'f': lambda a, b: a * 100 + b})
        self.assertEqual(vm.result, 409)

    def test_relative_branch_takes_true_path(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('96020005019d0200060096020005003e96020005013e'))
        self.assertTrue(vm.result)

    def test_register_function_preloads_this_and_argument(self):
        m = self.vm_module()
        # f(p in r2), preloadThis/suppressArguments/suppressSuper; returns this.x+p.
        raw = bytes.fromhex('8e0c0066000100032900027000100096050004010078004e9602000402473e00')
        vm = m.eval_actions(raw)
        self.assertEqual(vm.call(vm.variables['f'], [7], this={'x': 12}), 19)

    def test_native_url2_captures_url_target_and_flags(self):
        m = self.vm_module()
        raw = bytes.fromhex('960e000075726c00007061796c6f6164009a01000000')
        vm = m.eval_actions(raw)
        self.assertEqual(vm.fscommands, [('url', 'payload', 0)])

    def test_unknown_reachable_opcode_fails_closed(self):
        m = self.vm_module()
        with self.assertRaises(m.AVM1Error):
            m.eval_actions(bytes.fromhex('fe0000'))

    def test_truncated_action_fails_closed(self):
        m = self.vm_module()
        with self.assertRaises(m.AVM1Error):
            m.decode_actions(bytes.fromhex('960800006100'))

    def test_branch_into_payload_fails_closed(self):
        m = self.vm_module()
        with self.assertRaises(m.AVM1Error):
            m.eval_actions(bytes.fromhex('990200010096020005013e'))

    def test_unbound_function_fails_closed(self):
        m = self.vm_module()
        with self.assertRaises(m.AVM1Error):
            m.eval_actions(bytes.fromhex('96080007000000000066003d'))

    def test_native_url2_can_reenter_after_capture(self):
        m = self.vm_module()
        vm = m.VM(variables={})
        observed = []
        vm.fscommand_handler = lambda machine, url, arg, flags: observed.append(
            (list(machine.fscommands), url, arg, flags))
        vm.run(bytes.fromhex('960e000075726c00007061796c6f6164009a01000000'))
        self.assertEqual(observed, [([('url', 'payload', 0)], 'url', 'payload', 0)])

    def test_constant_pool_survives_function_definition(self):
        m = self.vm_module()
        # ConstantPool ['answer']; f() { return pool[0]; }.
        raw = bytes.fromhex('8809000100616e73776572009b060066000000060096020008003e00')
        vm = m.eval_actions(raw)
        self.assertEqual(vm.call(vm.variables['f']), 'answer')

    def test_missing_properties_serialize_as_undefined(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('960300006f001c9603000078004e3e'), variables={'o': {}})
        self.assertIs(vm.result, m.UNDEFINED)

    def test_instruction_limit_stops_infinite_loop(self):
        m = self.vm_module()
        with self.assertRaisesRegex(m.AVM1Error, 'instruction limit'):
            m.eval_actions(bytes.fromhex('990200fbff'), max_steps=7)

    def test_method_call_preserves_receiver_and_argument_order(self):
        m = self.vm_module()
        receiver = {'base': 5, 'sum': m.NativeFunction(
            lambda vm, this, args: this['base'] + args[0] * 100 + args[1])}
        raw = bytes.fromhex('961200070900000007040000000702000000006f001c9605000073756d00523e')
        vm = m.eval_actions(raw, variables={'o': receiver})
        self.assertEqual(vm.result, 414)

    def test_init_object_pairs_key_with_value(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('960d0000780007070000000701000000433e'))
        self.assertEqual(vm.result, {'x': 7})

    def test_strict_equality_distinguishes_boolean_and_number(self):
        m = self.vm_module()
        vm = m.eval_actions(bytes.fromhex('96070005010701000000663e'))
        self.assertFalse(vm.result)

    def test_shared_global_writes_are_visible_to_another_vm(self):
        m = self.vm_module()
        shared = {}
        first = bytes.fromhex('960900005f676c6f62616c001c960b000070656e64696e670005014f00')
        second = bytes.fromhex('960900005f676c6f62616c001c9609000070656e64696e67004e3e')
        m.eval_actions(first, global_env=shared)
        vm = m.eval_actions(second, global_env=shared)
        self.assertTrue(vm.result)

    def test_undefined_method_name_calls_function_with_current_this(self):
        m = self.vm_module()
        receiver = {'base': 5}
        function = m.NativeFunction(lambda vm, this, args: this['base'] + args[0] * 100 + args[1])
        raw = bytes.fromhex('9612000709000000070400000007020000000066001c96010003523e')
        vm = m.eval_actions(raw, variables={'f': function}, this=receiver)
        self.assertEqual(vm.result, 414)

    def test_char_code_at_returns_utf16_code_unit(self):
        m = self.vm_module()
        # charCodeAt(1) of U+1D11E is the low UTF-16 surrogate, not code point.
        raw = bytes.fromhex('9610000701000000070100000000f09d849e00960c000063686172436f6465417400523e')
        self.assertEqual(m.eval_actions(raw).result, 0xDD1E)

    def test_char_code_at_outside_string_returns_nan(self):
        m = self.vm_module()
        raw = bytes.fromhex('960d0007630000000701000000004100960c000063686172436f6465417400523e')
        self.assertTrue(math.isnan(m.eval_actions(raw).result))

    def test_char_code_at_exposes_space_character(self):
        m = self.vm_module()
        raw = bytes.fromhex('960d0007000000000701000000002000960c000063686172436f6465417400523e')
        self.assertEqual(m.eval_actions(raw).result, 32)

    def test_to_number_rejects_python_only_numeric_underscore(self):
        m = self.vm_module()
        raw = bytes.fromhex('96050000315f30004a3e')
        self.assertTrue(math.isnan(m.eval_actions(raw).result))

    def test_to_number_trims_ecma_bom_whitespace(self):
        m = self.vm_module()
        raw = bytes.fromhex('96090000efbbbf31efbbbf004a3e')
        self.assertEqual(m.eval_actions(raw).result, 1)

    def test_function_apply_preserves_explicit_receiver_arguments_and_return(self):
        m = self.vm_module()
        # f(p in r2) returns this.x+p; then return f.apply(receiver, args).
        raw = bytes.fromhex(
            '8e0c0066000100032900027000100096050004010078004e9602000402473e'
            '9606000061726773001c960a00007265636569766572001c'
            '96080007020000000066001c960700006170706c7900523e')
        vm = m.eval_actions(raw, variables={'receiver': {'x': 12}, 'args': [7]})
        self.assertEqual(vm.result, 19)

    def test_native_function_apply_preserves_receiver_and_argument_order(self):
        m = self.vm_module()
        receiver = {'base': 5}
        function = m.NativeFunction(
            lambda vm, this, args: this['base'] + args[0] * 100 + args[1])
        raw = bytes.fromhex(
            '9606000061726773001c960a00007265636569766572001c'
            '96080007020000000066001c960700006170706c7900523e')
        vm = m.eval_actions(raw, variables={
            'receiver': receiver, 'args': [4, 9], 'f': function})
        self.assertEqual(vm.result, 414)

    def test_function_apply_rejects_unmodeled_argument_object(self):
        m = self.vm_module()
        raw = bytes.fromhex(
            '9606000061726773001c960a00007265636569766572001c'
            '96080007020000000066001c960700006170706c7900523e')
        with self.assertRaisesRegex(m.AVM1Error, 'apply argument list'):
            m.eval_actions(raw, variables={
                'receiver': {}, 'args': {'0': 7, 'length': 1},
                'f': m.NativeFunction(lambda vm, this, args: 0)})

    def test_function_apply_null_or_undefined_receiver_uses_regular_function_context(self):
        m = self.vm_module()
        # f() { return this; }; null/undefined thisObject invokes it as a
        # regular function. The bounded VM's stored declaration context applies.
        define = bytes.fromhex('9b0600660000000b009606000074686973001c3e')
        invoke = bytes.fromhex('96080007020000000066001c960700006170706c7900523e')
        for values in ('9602000202', '9602000303'):
            with self.subTest(values=values):
                root = {}
                vm = m.eval_actions(define + bytes.fromhex(values) + invoke,
                                    variables=root)
                self.assertIs(vm.result, root)

    def test_function_apply_keeps_argument_and_receiver_object_identity(self):
        m = self.vm_module()
        receiver, first, second = {}, {}, []
        observed = []
        function = m.NativeFunction(lambda vm, this, args:
            observed.append((this, args)) or first)
        raw = bytes.fromhex(
            '9606000061726773001c960a00007265636569766572001c'
            '96080007020000000066001c960700006170706c7900523e')
        vm = m.eval_actions(raw, variables={
            'receiver': receiver, 'args': [first, second], 'f': function})
        self.assertIs(vm.result, first)
        self.assertIs(observed[0][0], receiver)
        self.assertIs(observed[0][1][0], first)
        self.assertIs(observed[0][1][1], second)

    def test_function_apply_null_or_undefined_argument_array_passes_no_arguments(self):
        m = self.vm_module()
        receiver = {}
        function = m.NativeFunction(lambda vm, this, args: (this, args))
        invoke = bytes.fromhex(
            '960a00007265636569766572001c96080007020000000066001c'
            '960700006170706c7900523e')
        for value in ('96010002', '96010003'):
            with self.subTest(value=value):
                vm = m.eval_actions(bytes.fromhex(value) + invoke,
                    variables={'receiver': receiver, 'f': function})
                self.assertIs(vm.result[0], receiver)
                self.assertEqual(vm.result[1], [])


if __name__ == '__main__':
    unittest.main()
