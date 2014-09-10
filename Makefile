all:
	@node-gyp clean 2>/dev/null
	node-gyp configure
	node-gyp build

clean:
	@node-gyp clean 2>/dev/null

.PHONY: all clean
