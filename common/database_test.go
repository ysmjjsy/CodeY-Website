package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSQLiteDSNKeepsConcurrencyParamsForBarePaths(t *testing.T) {
	const params = "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	for _, tc := range []struct {
		name string
		path string
		want string
	}{
		{name: "default file name", path: "codeguys.db", want: "codeguys.db" + params},
		{name: "bare absolute path", path: "/data/codeguys.db", want: "/data/codeguys.db" + params},
		{name: "bare file URI", path: "file:/data/codeguys.db", want: "file:/data/codeguys.db" + params},
		{name: "in-memory database", path: ":memory:", want: ":memory:" + params},
		{name: "own query string", path: "/data/codeguys.db?_pragma=busy_timeout(5000)", want: "/data/codeguys.db?_pragma=busy_timeout(5000)"},
		{name: "file URI with query", path: "file:test?mode=memory&cache=shared", want: "file:test?mode=memory&cache=shared"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, sqliteDSN(tc.path))
		})
	}
}
