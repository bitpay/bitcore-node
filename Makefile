all:
	@node-gyp clean 2>/dev/null
	node-gyp -d configure
	node-gyp build

clean:
	@node-gyp clean 2>/dev/null

.PHONY: all clean
