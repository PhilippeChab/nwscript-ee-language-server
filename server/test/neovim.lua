-- Run with: nvim --headless -u NONE -l server/test/neovim.lua /absolute/path/to/package/bin/nwscript-ee-language-server.cjs
local cli = assert(arg[1], 'Pass the installed CLI path')
local workspace = vim.fn.tempname()
vim.fn.mkdir(workspace .. '/lang/en', 'p')
vim.fn.mkdir(workspace .. '/ovr', 'p')
vim.fn.writefile({ 'test' }, workspace .. '/databuild.txt')
vim.fn.writefile({ 'int IntFn(int n);' }, workspace .. '/ovr/nwscript.nss')
vim.fn.writefile({ '// Helper', 'int Helper(int n);', 'int Helper(int n) { return n; }' }, workspace .. '/helper.nss')
vim.fn.writefile({ '#include "helper"', 'void main() { Helper( "bad" ); }' }, workspace .. '/sample.nss')
local client
local ok, err = pcall(function()
  vim.cmd.edit(vim.fn.fnameescape(workspace .. '/sample.nss'))
  vim.bo.filetype = 'nwscript'
  local bufnr = vim.api.nvim_get_current_buf()
  local id = assert(vim.lsp.start({
    name = 'nwscript',
    cmd = { 'node', cli, '--stdio' },
    root_dir = workspace,
    settings = {
      ['nwscript-ee-lsp'] = {
        compiler = { enabled = true, nwnHome = workspace, nwnInstallation = workspace },
        formatter = { enabled = true, executable = os.getenv('CLANG_FORMAT') or 'clang-format' },
      },
    },
  }))
  client = assert(vim.lsp.get_client_by_id(id))
  assert(vim.wait(20000, function() return client.initialized and #vim.diagnostic.get(bufnr) > 0 end, 50), 'Missing diagnostics')
  local params = { textDocument = { uri = vim.uri_from_bufnr(bufnr) }, position = { line = 1, character = 16 } }
  local function request(method, arguments)
    local result = assert(client:request_sync(method, arguments, 10000, bufnr))
    assert(not result.err, vim.inspect(result.err))
    return result.result
  end
  assert(vim.inspect(request('textDocument/hover', params)):find('Helper'), 'Missing hover')
  assert(vim.inspect(request('textDocument/definition', params)):find('helper.nss', 1, true), 'Missing definition')
  assert(vim.inspect(request('textDocument/completion', params)):find('Helper'), 'Missing completion')
  local edits = request('textDocument/formatting', { textDocument = params.textDocument, options = { tabSize = 4, insertSpaces = true } })
  assert(type(edits) == 'table' and #edits > 0, 'Missing formatting edits')
  client:stop()
  assert(vim.wait(10000, function() return client:is_stopped() end, 50), 'Server did not stop')
end)
if client and not client:is_stopped() then client:stop(true) end
vim.fn.delete(workspace, 'rf')
if not ok then
  io.stderr:write(tostring(err) .. '\n')
  vim.cmd('cquit 1')
end
print('Neovim: initialization, diagnostics, completion, hover, definition, formatting, and shutdown passed.')
vim.cmd('qa!')
