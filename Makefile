.PHONY: setup dev dev-no-db stop status env build test

setup:
	./setup.sh

dev:
	./dev.sh up

dev-no-db:
	./dev.sh up --no-db

stop:
	./dev.sh stop

status:
	./dev.sh status

env:
	./env.sh

build:
	cd bfa-digital && pnpm build
	cd psycho-form/psychoform && ./mvnw package -DskipTests

test:
	cd bfa-digital && pnpm test
	cd psycho-form/psychoform && ./mvnw test
