# Changelog

## 1.0.0 (2026-06-01)


### Features

* **llm:** add tool call support and use framework llm use everywhere ([5ba262d](https://github.com/tibzejoker/brAIn-memory/commit/5ba262d59fc420ef21c426e0ca52dc18bc502a11))
* **seeds:** ship memory-chat template ([8914237](https://github.com/tibzejoker/brAIn-memory/commit/89142373fe68373fba6acd3d9494d781bcf808e3))
* **skills:** bundle use-memory skill ([#15](https://github.com/tibzejoker/brAIn-memory/issues/15)) ([46d752b](https://github.com/tibzejoker/brAIn-memory/commit/46d752b2bbd6ecbacda2c8db9fbe13dc8d823023))


### Bug Fixes

* **memory-proxy:** ctx.llm.tool() returns args directly, not {toolName, args} ([de7d224](https://github.com/tibzejoker/brAIn-memory/commit/de7d22450d2c03424d8b5cd2a229e3d4f591b144))
* **memory:** declare every topic the handlers actually publish on ([#13](https://github.com/tibzejoker/brAIn-memory/issues/13)) ([87e366d](https://github.com/tibzejoker/brAIn-memory/commit/87e366d7f250f7bfb553384b78a5317ccc1e178a))
* **test:** memory-vector teardown skips scandir when data dir is absent ([#10](https://github.com/tibzejoker/brAIn-memory/issues/10)) ([507596e](https://github.com/tibzejoker/brAIn-memory/commit/507596ee07f7d56f185a9553d13f7569bc4914db))
